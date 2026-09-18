/**
 * 取流调度器
 *
 * 洛雪音源脚本只提供「给我歌曲信息，我给你播放地址」这一个能力，
 * 但同一个平台往往有十几个音源可用，且各自稳定性不同。
 * 这个调度器的任务就是：把「一次播放请求」变成一次可靠的取流。
 *
 * 策略：
 *  1. 候选音源按可用性评分排序（成功率 / 连续失败 / 响应速度）
 *  2. 音质从高到低分层尝试，保证优先拿到无损
 *  3. 层内前 N 个并发竞速（快速出结果），全失败再顺延剩余音源
 *  4. 每次结果回写统计，让调度越用越准
 */
import type {
  Lyric,
  MusicUrlRequest,
  MusicUrlResult,
  Quality,
  Song,
  SourceAttempt
} from '@shared/types/music'
import { APP_CONST, qualityRank } from '@shared/constants'
import { errorMessage } from '@main/utils/error'
import { fetchBuiltinLyric } from '../lyric'
import type { LoadedSource, SourceManager } from './manager'
import type { StreamProxy } from '../proxy/stream-proxy'

/**
 * 每层并发竞速的音源数量。
 * 数值越大首屏出结果越快，但并发请求也越多、越容易触发音源侧限流。
 * 4 是「快速出结果」与「别把公益音源打爆」之间的折中：
 * 实测同一平台首批失败源串行试完要 50 秒以上，并发后降到个位数秒。
 */
const RACE_WIDTH = 4

/** 音源返回的地址可能带自定义请求头 */
interface NormalizedUrl {
  url: string
  headers?: Record<string, string>
}

export interface ResolverDeps {
  sources: SourceManager
  proxy: StreamProxy
  onLog?: (level: 'info' | 'warn' | 'error', scope: string, message: string) => void
}

export class MusicResolver {
  private readonly deps: ResolverDeps

  /**
   * 取流结果短期缓存。
   *
   * 音源给的多是带签名的临时地址（几分钟就失效），所以不能长期缓存；
   * 但「重复播放同一首」「拖完进度重新取流」「切回上一首」这些动作极其频繁，
   * 几分钟的缓存就足以省掉大量音源请求，也顺带降低触发限流的概率。
   */
  private readonly urlCache = new Map<
    string,
    { result: MusicUrlResult; expireAt: number }
  >()

  /** 缓存有效期 */
  private static readonly CACHE_TTL = 4 * 60 * 1000

  constructor(deps: ResolverDeps) {
    this.deps = deps
  }

  private cacheKey(song: Song, quality?: Quality): string {
    return `${song.platform}:${song.songmid}:${quality ?? 'auto'}`
  }

  /** 读缓存；过期即删 */
  private readCache(song: Song, quality?: Quality): MusicUrlResult | null {
    const key = this.cacheKey(song, quality)
    const entry = this.urlCache.get(key)
    if (!entry) return null
    if (Date.now() >= entry.expireAt) {
      this.urlCache.delete(key)
      return null
    }
    return entry.result
  }

  /** 写缓存，顺带做一次惰性清理，避免 Map 无限膨胀 */
  private writeCache(song: Song, requestQuality: Quality | undefined, result: MusicUrlResult): void {
    if (this.urlCache.size > 200) {
      const now = Date.now()
      for (const [key, entry] of this.urlCache) {
        if (entry.expireAt <= now) this.urlCache.delete(key)
      }
    }
    this.urlCache.set(this.cacheKey(song, requestQuality), {
      result,
      expireAt: Date.now() + MusicResolver.CACHE_TTL
    })
  }

  /**
   * 清缓存。
   * 传 song 只清这首歌 —— 换源重试时必须这样做，否则会直接命中刚才那条坏地址；
   * 不传则整体清空。
   */
  clearCache(song?: Song): void {
    if (!song) {
      this.urlCache.clear()
      return
    }
    const prefix = `${song.platform}:${song.songmid}:`
    for (const key of [...this.urlCache.keys()]) {
      if (key.startsWith(prefix)) this.urlCache.delete(key)
    }
  }

  /**
   * 上报「这个音源在这首歌上不合格」。
   *
   * 目前唯一的触发场景是「只给试听片段」：实测有音源返回 47.9 秒的音频，
   * 而歌曲本身标注 250 秒。这类源响应往往还很快，不主动标记的话
   * 调度器会一直优先选它 —— 用户听到的永远是半截歌。
   */
  reportBadSource(sourceId: string, song: Song, reason = '质量不合格'): void {
    // 冷却 30 分钟：这类问题通常来自接口策略，短时间内不会自愈
    this.deps.sources.markCooldown(sourceId, song.platform, 30 * 60 * 1000)
    // 清掉这首歌的缓存，否则「换源重试」会命中同一条坏地址
    this.clearCache(song)
    this.deps.onLog?.(
      'warn',
      'resolver',
      `音源 ${sourceId} 在 ${song.platform} 被标记为不合格：${reason}`
    )
  }

  /**
   * 取播放地址。
   * 成功时返回的 url 已经过本地代理包装，可直接交给 <audio>。
   */
  async resolve(req: MusicUrlRequest): Promise<MusicUrlResult> {
    const { song } = req
    const attempts: SourceAttempt[] = []

    if (song.platform === 'local') {
      throw new Error('本地歌曲无需取流')
    }

    // 命中缓存直接返回：重复播放、拖完进度重取、切回上一首都不必再打扰音源
    const cached = this.readCache(song, req.quality)
    if (cached) {
      this.deps.onLog?.('info', 'resolver', `取流命中缓存 [${song.platform}] ${song.name}`)
      return cached
    }

    const candidates = this.pickCandidates(song, req.sourceIds)
    if (candidates.length === 0) {
      throw new Error(
        `没有可用于「${song.platform}」平台的音源，请先在音源管理页导入并启用音源`
      )
    }

    const ladder = this.qualityLadder(song, req.quality)

    // 按音质从高到低逐层尝试
    for (const quality of ladder) {
      const group = candidates.filter((src) => this.supportsQuality(src, song.platform, quality))
      if (group.length === 0) continue

      const hit = await this.attemptGroup(group, song, quality, attempts)
      if (hit) {
        const result = this.buildResult(hit, song, quality, attempts)
        this.writeCache(song, req.quality, result)
        return result
      }
    }

    // 所有音质层都失败，用错误汇总给出可读原因
    const detail = attempts
      .slice(0, 6)
      .map((a) => `${a.sourceName}: ${a.error ?? '失败'}`)
      .join('；')
    throw new Error(
      `全部音源均取流失败（共尝试 ${attempts.length} 次）${detail ? ` — ${detail}` : ''}`
    )
  }

  /**
   * 取歌词。多音源里任何一个能提供即返回。
   */
  async getLyric(song: Song, sourceIds?: string[]): Promise<Lyric | null> {
    const candidates = this.pickCandidates(song, sourceIds).filter((src) =>
      this.supportsAction(src, song.platform, 'lyric')
    )

    for (const src of candidates) {
      const started = Date.now()
      try {
        const raw = await this.dispatch(src, 'lyric', song, '128k')
        const lyric = this.normalizeLyric(raw)
        if (lyric && (lyric.lyric || lyric.tlyric)) {
          this.deps.sources.recordStat(src.id, true, Date.now() - started)
          return { ...lyric, sourceId: src.id }
        }
        this.deps.sources.recordStat(src.id, false, Date.now() - started, '歌词为空')
      } catch (err) {
        const msg = errorMessage(err)
        this.deps.sources.recordStat(src.id, false, Date.now() - started, msg)
        this.deps.onLog?.('warn', 'resolver', `歌词获取失败 ${src.info.name}: ${msg}`)
      }
    }

    /**
     * 音源都拿不到时，退回内置歌词服务。
     *
     * 这里纠正了一个错误假设：歌词**不该依赖音源**。
     * 实测声明支持歌词的音源（酷我那两个）接口早已失效，
     * 于是「有歌可听」被「音源还愿意给歌词」绑架了 —— 而歌词本是跨平台通用的。
     */
    const builtin = await fetchBuiltinLyric(song)
    if (builtin) {
      this.deps.onLog?.('info', 'resolver', `歌词取自内置服务: ${song.name}`)
      return builtin
    }

    return null
  }

  /* ------------------------------ 候选与音质 ------------------------------ */

  /** 决定候选音源：显式指定优先，否则按能力自动挑选 */
  private pickCandidates(song: Song, sourceIds?: string[]): LoadedSource[] {
    if (sourceIds && sourceIds.length > 0) {
      const picked: LoadedSource[] = []
      for (const id of sourceIds) {
        const src = this.deps.sources.get(id)
        if (src && src.info.status === 'ready' && this.deps.sources.isEnabled(id)) {
          if (this.supportsAction(src, song.platform, 'musicUrl')) picked.push(src)
        }
      }
      if (picked.length > 0) return picked
    }
    return this.deps.sources.findCapable(song.platform, 'musicUrl')
  }

  /** 音源是否声明支持某 action */
  private supportsAction(src: LoadedSource, platform: string, action: string): boolean {
    const cap = src.info.capabilities.find((c) => c.platform === platform)
    return Boolean(cap && cap.actions.includes(action as never))
  }

  /** 音源是否声明支持某音质（未声明音质时放行，交由运行时判定） */
  private supportsQuality(src: LoadedSource, platform: string, quality: Quality): boolean {
    const cap = src.info.capabilities.find((c) => c.platform === platform)
    if (!cap) return false
    if (cap.qualities.length === 0) return true
    return cap.qualities.includes(quality)
  }

  /**
   * 音质阶梯：优先期望音质，拿不到就逐级降。
   * 无损失败降 320k，再降 128k —— 保证「总能听到歌」。
   */
  private qualityLadder(song: Song, prefer?: Quality): Quality[] {
    const declared = song.qualities?.length ? song.qualities : ['320k', '128k']
    const desc = [...new Set(declared)].sort((a, b) => qualityRank(b) - qualityRank(a))

    if (!prefer) return desc

    const limit = qualityRank(prefer)
    const within = desc.filter((q) => qualityRank(q) <= limit)
    if (within.length > 0) return within
    // 期望音质低于所有可用音质时，退到最低可用，避免直接失败
    return [desc[desc.length - 1]]
  }

  /* ------------------------------ 尝试与竞速 ------------------------------ */

  /**
   * 对一组音源尝试取流：先并发竞速前 N 个，失败则顺延剩余。
   */
  private async attemptGroup(
    group: LoadedSource[],
    song: Song,
    quality: Quality,
    attempts: SourceAttempt[]
  ): Promise<{ src: LoadedSource; url: NormalizedUrl } | null> {
    let remaining = [...group]

    while (remaining.length > 0) {
      const wave = remaining.slice(0, RACE_WIDTH)
      remaining = remaining.slice(RACE_WIDTH)

      const hit = await this.raceWave(wave, song, quality, attempts)
      if (hit) return hit
    }
    return null
  }

  /** 一轮并发：第一个成功即返回 */
  private raceWave(
    wave: LoadedSource[],
    song: Song,
    quality: Quality,
    attempts: SourceAttempt[]
  ): Promise<{ src: LoadedSource; url: NormalizedUrl } | null> {
    return new Promise((resolve) => {
      if (wave.length === 0) {
        resolve(null)
        return
      }

      let settled = 0
      let finished = false

      for (const src of wave) {
        const started = Date.now()
        this.dispatch(src, 'musicUrl', song, quality)
          .then((raw) => {
            const cost = Date.now() - started
            const normalized = normalizeUrlResult(raw)
            attempts.push({
              sourceId: src.id,
              sourceName: src.info.name,
              ok: true,
              cost
            })
            this.deps.sources.recordStat(src.id, true, cost)
            if (!finished) {
              finished = true
              resolve({ src, url: normalized })
            }
          })
          .catch((err: unknown) => {
            const cost = Date.now() - started
            const msg = errorMessage(err)
            attempts.push({
              sourceId: src.id,
              sourceName: src.info.name,
              ok: false,
              error: msg,
              cost
            })
            this.deps.sources.recordStat(src.id, false, cost, msg)
            // 记入短期冷却：否则下一首歌会把同一条死路再走一遍
            this.deps.sources.markCooldown(src.id, song.platform)
          })
          .finally(() => {
            settled += 1
            if (settled >= wave.length && !finished) {
              finished = true
              resolve(null)
            }
          })
      }
    })
  }

  /** 派发一次调用到具体音源（按协议分流） */
  private async dispatch(
    src: LoadedSource,
    action: 'musicUrl' | 'lyric' | 'pic',
    song: Song,
    quality: Quality
  ): Promise<unknown> {
    const musicInfo = toMusicInfo(song)

    // 洛雪协议
    if (src.lxRuntime && src.info.format === 'lx') {
      return src.lxRuntime.dispatch({
        action,
        source: song.platform,
        info: {
          type: quality,
          musicInfo,
          quality,
          // 部分脚本读 info.type / info.quality 两种写法，这里都给上
          keyword: song.name,
          page: 1,
          pagesize: 30
        }
      })
    }

    // MusicFree 插件协议
    if (src.info.format === 'musicfree') {
      const plugin = src.exports as Record<string, (...args: unknown[]) => unknown> | null
      if (!plugin) throw new Error('插件导出为空')
      if (action === 'musicUrl') {
        if (typeof plugin.getMediaSource !== 'function') throw new Error('插件不支持取流')
        return plugin.getMediaSource(musicInfo, quality)
      }
      if (action === 'lyric') {
        if (typeof plugin.getLyric !== 'function') throw new Error('插件不支持歌词')
        return plugin.getLyric(musicInfo)
      }
      if (action === 'pic') {
        if (typeof plugin.getCover !== 'function') throw new Error('插件不支持封面')
        return plugin.getCover(musicInfo)
      }
    }

    throw new Error('音源未提供所需能力')
  }

  /** 组装最终结果（含本地代理包装） */
  private buildResult(
    hit: { src: LoadedSource; url: NormalizedUrl },
    song: Song,
    quality: Quality,
    attempts: SourceAttempt[]
  ): MusicUrlResult {
    const { src, url } = hit
    const needsProxy = /^https?:/i.test(url.url)
    const finalUrl = needsProxy
      ? this.deps.proxy.wrap(url.url, { platform: song.platform, headers: url.headers })
      : url.url

    this.deps.onLog?.(
      'info',
      'resolver',
      `取流成功 [${song.platform}] ${song.name} @${quality} ← ${src.info.name}`
    )

    return {
      url: finalUrl,
      quality,
      sourceId: src.id,
      sourceName: src.info.name,
      proxied: needsProxy,
      ext: guessExt(url.url),
      attempts
    }
  }

  /** 规范化歌词返回值 */
  private normalizeLyric(raw: unknown): Lyric | null {
    if (!raw) return null
    if (typeof raw === 'string') return { lyric: raw }
    if (typeof raw === 'object') {
      const o = raw as Record<string, unknown>
      const lyric = pickString(o.lyric) ?? pickString(o.lrc) ?? ''
      const tlyric = pickString(o.tlyric) ?? ''
      const rlyric = pickString(o.rlyric) ?? ''
      const lxlyric = pickString(o.lxlyric) ?? ''
      if (!lyric && !tlyric && !rlyric && !lxlyric) return null
      return { lyric, tlyric, rlyric, lxlyric }
    }
    return null
  }
}

/* ------------------------------ 辅助函数 ------------------------------ */

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * 把统一歌曲结构还原成音源脚本期望的 musicInfo。
 *
 * 关键：音源脚本内部普遍是 `musicInfo.hash ?? musicInfo.songmid`，
 * 因此这两个字段必须齐全；其余平台私有字段通过 raw 原样透传。
 */
export function toMusicInfo(song: Song): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ...(song.raw ?? {}),
    songmid: song.songmid,
    hash: song.hash ?? song.songmid,
    songId: song.songId ?? song.songmid,
    mid: song.songmid,
    id: song.songId ?? song.songmid,
    name: song.name,
    singer: song.singer,
    albumName: song.albumName,
    albumId: song.albumId,
    albumMid: song.albumId,
    interval: song.duration,
    duration: song.duration,
    picUrl: song.picUrl,
    source: song.platform,
    type: song.platform
  }

  // 洛雪会把「同一首歌在各平台的 id」放进 _types，部分音源靠它跨平台取流
  base._types = {
    ...((song.raw?._types as Record<string, unknown>) ?? {}),
    [song.platform]: {
      songmid: song.songmid,
      hash: song.hash ?? song.songmid,
      id: song.songId ?? song.songmid,
      mid: song.songmid
    }
  }

  return base
}

/** 规范化音源返回的地址形态 */
function normalizeUrlResult(raw: unknown): NormalizedUrl {
  if (typeof raw === 'string') {
    if (!raw) throw new Error('音源返回空地址')
    return { url: raw }
  }

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const headers =
      obj.headers && typeof obj.headers === 'object'
        ? (obj.headers as Record<string, string>)
        : undefined

    // 洛雪 2.6+ 允许返回 { url, headers }
    const direct = pickString(obj.url) ?? pickString(obj.musicUrl)
    if (direct) return { url: direct, headers }

    // 少数音源把结果再包一层 data
    const data = obj.data
    if (data && typeof data === 'object') {
      const nested = pickString((data as Record<string, unknown>).url)
      if (nested) {
        const nestedHeaders =
          (data as Record<string, unknown>).headers as Record<string, string> | undefined
        return { url: nested, headers: nestedHeaders ?? headers }
      }
    }
    if (typeof data === 'string' && data) return { url: data, headers }
  }

  throw new Error('音源返回了无法识别的地址格式')
}

/** 由地址猜扩展名 */
function guessExt(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname
    const m = /\.([a-z0-9]{2,5})$/i.exec(pathname)
    return m ? m[1].toLowerCase() : undefined
  } catch {
    return undefined
  }
}

/** 取流超时兜底（供外部复用同一常量） */
export const RESOLVE_TIMEOUT = APP_CONST.fetchTimeout
