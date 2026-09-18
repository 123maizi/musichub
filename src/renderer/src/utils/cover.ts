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

/** 同时最多几个补图请求 */
const MAX_CONCURRENT = 3

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
 * 酷我的封面地址形如 `.../star/albumcover/120/xx/yy/123.jpg`，
 * 开头那个 `120` 就是尺寸（实测 120/300/500/1000 都认，分别约
 * 2.6KB / 14KB / 52KB / 263KB）。列表里用 120 省流量，
 * 到了正在播放页那种大图上再要 500，不然就是拿 120px 硬撑 320px。
 *
 * 注意：它换的只是尺寸，换不出内容 —— 有些专辑酷我压根没给真封面
 * （它用一张「红底＋中间一张小图」的占位图顶上），这种只能靠别家补图。
 */
export function bigCoverUrl(url?: string): string | undefined {
  if (!url) return url
  return url.replace(/(\/star\/albumcover\/)\d+(\/)/, '$1500$2')
}
