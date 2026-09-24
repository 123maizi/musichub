/**
 * 封面补全（渲染层，带并发限流）
 *
 * 背景：网易云封面对绝大多数歌都能取到，所以让缺封面的歌都去它那里补一张
 * （酷我大多没封面字段，酷狗给的是同一张占位图）。
 *
 * 但列表里一次几十首歌，如果每首都直接发请求，等于把别人的接口当自家 CDN 用。
 * 所以这里加一道并发闸门：最多同时 3 个请求，其余排队；
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

let running = 0
const waiting: Array<() => void> = []
const cache = new Map<string, string | null>()

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

/**
 * 解析封面（带限流与缓存）。
 * 取不到就返回 null，调用方显示占位图标即可 —— 绝不返回假图。
 */
export async function resolveCoverThrottled(song: Song): Promise<string | null> {
  const key = keyOf(song)
  if (cache.has(key)) return cache.get(key) ?? null

  await acquire()
  try {
    const url = await resolveCover(song)
    cache.set(key, url)
    return url
  } catch {
    // 失败同样入缓存，避免同一首歌反复重试把接口打爆
    cache.set(key, null)
    return null
  } finally {
    release()
  }
}

/** 已缓存的封面数量（诊断用） */
export function coverCacheSize(): number {
  return cache.size
}

/**
 * 把列表用的小图地址，换成大图地址。
 *
 * 各平台的封面地址里都带一个尺寸段，列表用小图省流量，
 * 到了正在播放页那种大图上再要大的：
 *   · 酷我 `.../star/albumcover/120/xx/yy/123.jpg` → 500（实测 2.6KB → 52KB）
 *   · 酷狗 `imge.kugou.com/stdmusic/240/日期/xxx.jpg` → 800（实测 29KB → 188KB）
 *
 * 注意：换的只是尺寸，换不出内容 —— 有些专辑平台压根没给真封面，
 * 那种只能靠别家补图（见 CoverImage 的 preferResolved）。
 */
export function bigCoverUrl(url?: string): string | undefined {
  if (!url) return url
  if (url.includes('/star/albumcover/')) {
    return url.replace(/(\/star\/albumcover\/)\d+(\/)/, '$1500$2')
  }
  if (url.includes('imge.kugou.com/stdmusic/')) {
    return url.replace(/(imge\.kugou\.com\/stdmusic\/)\d+(\/)/, '$1800$2')
  }
  return url
}
