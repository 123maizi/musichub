/**
 * 封面补全（渲染层，带并发限流）
 *
 * 背景：网易云封面对绝大多数歌都能取到，所以让缺封面的歌都去它那里补一张
 * （酷我大多没封面字段，酷狗给的是同一张占位图）。
 *
 * 但列表里一次几十首歌，如果每首都直接发请求，等于把别人的接口当自家 CDN 用。
 * 所以这里加一道并发闸门：最多同时 8 个请求，其余排队；
 * 再加一层内存缓存 —— 同一首歌出现在多个列表里时不必重复请求。
 */
import type { Song } from '@shared/types/music'
import { resolveCover } from './ipc'

/**
 * 同时最多几个补图请求。
 *
 * 原来是 3，实测不够用：一页 110 条里有三四十条缺封面
 * （酷我的搜索结果常常没有专辑信息，只能跨平台补），
 * 3 并发要排很久，用户看到的就是「大片大片的占位图标」。
 * 提到 8 之后列表能在几秒内补齐。
 *
 * 也不能无限提 —— 补图走的是别人的搜索接口，
 * 并发太高等于拿它当自家 CDN 用，而且容易被限流。
 */
const MAX_CONCURRENT = 8

/**
 * 单个补图请求最多等多久。
 *
 * 主进程那边的总预算是 12 秒（见 core/cover/index.ts），这里留足余量。
 * 这个超时是**槽位泄漏的兜底**：万一某个请求因为主进程卡住而永不返回，
 * 没有它的话 `running` 只增不减，8 个槽位漏光之后整个列表再也补不出封面，
 * 表现就是「用着用着封面全没了」。
 */
const RESOLVE_TIMEOUT_MS = 20000

/** 补图结果缓存上限，超了半量淘汰 */
const CACHE_LIMIT = 3000

/**
 * 负结果（没补到）只缓存 60 秒。
 *
 * 原来失败是长期缓存的 —— 一次网络抖动就让这首歌在整个会话里再也补不上，
 * 正是「有些封面死活加载不出来」的高概率原因。给个短 TTL：
 * 同一屏的重复请求照样被挡住，但抖动过去之后会自动再试。
 *
 * 与主进程的 FAIL_TTL_MS（20 秒）配合：这里挡住重复挂载，
 * 那边挡住同一首歌被反复真的请求上游。
 */
const FAIL_TTL_MS = 60_000

interface CoverCacheEntry {
  url: string | null
  at: number
}

let running = 0
const waiting: Array<() => void> = []
const cache = new Map<string, CoverCacheEntry>()
/** 同一个 key 正在请求中：多个组件同时挂载同一首歌时只发一次 */
const inflight = new Map<string, Promise<string | null>>()

function keyOf(song: Song): string {
  return `${song.name}|${song.singer}`.trim().toLowerCase()
}

/** 申请一个执行位；拿到后必须调用 release 归还 */
function acquire(): Promise<void> {
  return new Promise((resolve) => {
    const grant = (): void => {
      running += 1
      resolve()
    }
    if (running < MAX_CONCURRENT) grant()
    else waiting.push(grant)
  })
}

function release(): void {
  running = Math.max(0, running - 1)
  const next = waiting.shift()
  if (next) next()
}

/** 给 Promise 套一个超时：超时就当失败，绝不让调用方永远挂着 */
function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('封面补图超时')), ms)
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function remember(key: string, url: string | null): void {
  if (cache.size >= CACHE_LIMIT) {
    for (const oldKey of [...cache.keys()].slice(0, Math.floor(CACHE_LIMIT / 2))) cache.delete(oldKey)
  }
  cache.set(key, { url, at: Date.now() })
}

/** 读缓存；负结果过期就当作没缓存 */
function readCache(key: string): { hit: boolean; url: string | null } {
  const entry = cache.get(key)
  if (!entry) return { hit: false, url: null }
  if (entry.url) return { hit: true, url: entry.url }
  if (Date.now() - entry.at < FAIL_TTL_MS) return { hit: true, url: null }
  cache.delete(key)
  return { hit: false, url: null }
}

/**
 * 解析封面（带限流与缓存）。
 * 取不到就返回 null，调用方显示占位图标即可 —— 绝不返回假图。
 *
 * `force`：跳过**负**缓存，真的去请求一次。给「延迟自愈重试」用 ——
 * 实测同一首歌在列表刚加载时补图失败（上游返回被限流后的空结果），
 * 三分钟后再问就能拿到；没有 force 的话这种抖动会被负缓存一直挡回去。
 * 正缓存（已经补到的封面）永远优先，force 不会让它重复请求。
 */
export async function resolveCoverThrottled(
  song: Song,
  force = false
): Promise<string | null> {
  const key = keyOf(song)
  const cached = readCache(key)
  if (cached.url) return cached.url
  if (cached.hit && !force) return null

  const pending = inflight.get(key)
  if (pending) return pending

  const task = (async (): Promise<string | null> => {
    await acquire()
    let url: string | null = null
    try {
      url = await withTimeout(resolveCover(song), RESOLVE_TIMEOUT_MS)
    } catch {
      // 失败同样入缓存（短 TTL），避免同一屏里反复重试把接口打爆
      url = null
    } finally {
      // 必须放在 finally：中途任何异常都不能把并发槽位留在这儿
      release()
    }
    remember(key, url)
    return url
  })()

  const tracked = task.finally(() => {
    inflight.delete(key)
  })
  inflight.set(key, tracked)
  return tracked
}

/** 已缓存的封面数量（诊断用） */
export function coverCacheSize(): number {
  return cache.size
}

/* ------------------------------------------------------------------ *
 * 封面走本地流代理的兜底
 *
 * 各平台 CDN 普遍校验 Referer / UA，裸地址直接给 <img> 有概率 403。
 * 主进程本来就有一个只监听 127.0.0.1 的流代理（/stream?u=），
 * 它会在服务端补上 Referer/UA，所以直连失败时用它再试一次，
 * 比「直接判死刑、显示占位图标」稳得多。
 * ------------------------------------------------------------------ */

/** 各平台封面 CDN 期望的 Referer */
const COVER_REFERER: Record<string, string> = {
  kw: 'https://www.kuwo.cn/',
  kg: 'https://www.kugou.com/',
  tx: 'https://y.qq.com/',
  wy: 'https://music.163.com/',
  mg: 'https://music.migu.cn/'
}

let proxyPort = 0
const proxyReady: Promise<number> = (async () => {
  try {
    const info = await window.api.app.info()
    proxyPort = info?.proxyPort ?? 0
  } catch {
    proxyPort = 0
  }
  return proxyPort
})()

/** 等代理端口就绪（端口是启动时才知道的，通常第一帧就已经拿到） */
export function ensureCoverProxyPort(): Promise<number> {
  return proxyReady
}

/** UTF-8 字符串 → base64url（与主进程 Proxy 的包装格式一致） */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * 把封面地址包成本地代理地址。
 *
 * 同步返回：端口是模块加载时就异步取好的，取到之前返回 null
 * （调用方会退化成「代理那条候选不存在」，不影响直连）。
 */
export function proxiedCoverUrl(platform: string | undefined, url: string): string | null {
  if (!proxyPort || !url) return null
  const params = new URLSearchParams()
  params.set('u', toBase64Url(url))
  const referer = platform ? COVER_REFERER[platform] : undefined
  if (referer) params.set('r', referer)
  return `http://127.0.0.1:${proxyPort}/stream?${params.toString()}`
}

/**
 * 把列表用的小图地址，换成大图地址。
 *
 * 各平台的封面地址里都带一个尺寸段，列表用小图省流量，
 * 到了正在播放页那种大图上再要大的（下面每一档都实测过）：
 *   · 酷我 `.../star/albumcover/120/xx/yy/123.jpg` → 500（实测 6KB → 53KB）
 *   · 酷狗 `imge.kugou.com/stdmusic/240/日期/xxx.jpg` → 800（实测 30KB → 193KB）
 *   · QQ   `T002R300x300M000…` → `T002R500x500M000…`（实测 33KB → 81KB）
 *   · 网易云 `...jpg?param=300y300` → `param=500y500`（实测 12KB → 25KB）
 *
 * 注意：换的只是尺寸，换不出内容 —— 有些专辑平台压根没给真封面，
 * 那种只能靠别家补图（见 CoverImage 的 preferResolved）。
 * 咪咕刻意不换：它的 `…/resource/00/…` 里那个 00 不是尺寸段，换成 300/500 实测 404。
 */
export function bigCoverUrl(url?: string): string | undefined {
  if (!url) return url
  if (url.includes('/star/albumcover/')) {
    return url.replace(/(\/star\/albumcover\/)\d+(\/)/, '$1500$2')
  }
  if (url.includes('imge.kugou.com/stdmusic/')) {
    return url.replace(/(imge\.kugou\.com\/stdmusic\/)\d+(\/)/, '$1800$2')
  }
  if (url.includes('y.gtimg.cn/music/photo_new/T002R')) {
    return url.replace(/T002R\d+x\d+M000/, 'T002R500x500M000')
  }
  if (url.includes('music.126.net')) {
    return url.replace(/([?&]param=)\d+[xy]\d+/, '$1500y500')
  }
  return url
}
