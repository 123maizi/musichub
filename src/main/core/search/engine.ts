/**
 * 搜索聚合引擎
 *
 * 两条搜索通道：
 *  - builtin：内置的五大平台官方接口（默认，覆盖最广）
 *  - source ：交给音源脚本自带的 musicSearch（少数音源提供，可作补充）
 *
 * 所有平台并发发起，单个平台失败不影响其它平台，
 * 失败原因随结果一起返回，UI 可以逐平台展示「哪些源挂了」。
 */
import type {
  PlatformSearchResult,
  SearchRequest,
  SearchResponse,
  Song
} from '@shared/types/music'
import { APP_CONST, qualityRank } from '@shared/constants'
import type { SourceManager } from '../source/manager'
import { builtinProviders, type ProviderSearchResult, type SearchProvider } from './builtin'

export interface SearchEngineDeps {
  sources: SourceManager
  onLog?: (level: 'info' | 'warn' | 'error', scope: string, message: string) => void
}

export class SearchEngine {
  private readonly deps: SearchEngineDeps
  private readonly providers: SearchProvider[]

  /**
   * 搜索结果短期缓存。
   *
   * 用户常来回切换关键词、翻回上一页、点歌手名反复进出，
   * 每次都并发打五个平台既慢又容易触发限流。
   * 90 秒的窗口足够覆盖这类操作，又不至于让结果显得陈旧。
   */
  private readonly cache = new Map<string, { response: SearchResponse; expireAt: number }>()

  private static readonly CACHE_TTL = 90 * 1000

  constructor(deps: SearchEngineDeps) {
    this.deps = deps
    this.providers = [...builtinProviders]
  }

  private cacheKey(keyword: string, page: number, channel: string, platforms?: string[]): string {
    const p = platforms && platforms.length > 0 ? [...platforms].sort().join(',') : 'all'
    return `${channel}|${keyword}|${page}|${p}`
  }

  /** 清空搜索缓存 */
  clearCache(): void {
    this.cache.clear()
  }

  /** 内置 Provider 名录（供 UI 展示可搜索的平台） */
  listProviders(): { id: string; name: string; platform: string; enabled: boolean }[] {
    return this.providers.map((p) => ({
      id: p.id,
      name: p.name,
      platform: p.platform,
      enabled: p.enabled
    }))
  }

  /** 开关某个平台的搜索 */
  setProviderEnabled(id: string, enabled: boolean): void {
    const p = this.providers.find((x) => x.id === id)
    if (p) p.enabled = enabled
  }

  /** 聚合搜索 */
  async search(req: SearchRequest): Promise<SearchResponse> {
    const started = Date.now()
    const keyword = (req.keyword ?? '').trim()
    const page = req.page && req.page > 0 ? req.page : 1
    const limit = req.limit && req.limit > 0 ? Math.min(req.limit, 50) : 30

    if (!keyword) {
      return { keyword, page, platforms: [], cost: 0 }
    }

    const channel = req.channel ?? 'builtin'

    // 命中缓存直接返回，省掉五个平台的并发请求
    const key = this.cacheKey(keyword, page, channel, req.platforms)
    const cached = this.cache.get(key)
    if (cached && Date.now() < cached.expireAt) {
      return { ...cached.response, cost: 0 }
    }

    const tasks =
      channel === 'source'
        ? await this.sourceSearchTasks(keyword, page, limit, req.platforms)
        : this.builtinSearchTasks(keyword, page, limit, req.platforms)

    const settled = await Promise.all(tasks.map((t) => this.runWithTimeout(t)))

    // 给结果补齐「本机音源实际支持的音质」，让取流时不必盲试
    for (const result of settled) {
      for (const song of result.songs) this.enrichQualities(song)
      // 原唱优先：把翻唱 / 伴奏 / DJ 版沉到后面
      this.rankSongs(result.songs, keyword)
    }

    const response: SearchResponse = {
      keyword,
      page,
      platforms: settled,
      cost: Date.now() - started
    }

    // 写入缓存（顺手把过期项清掉）
    if (this.cache.size > 60) {
      const now = Date.now()
      for (const [k, v] of this.cache) {
        if (v.expireAt <= now) this.cache.delete(k)
      }
    }
    this.cache.set(key, { response, expireAt: Date.now() + SearchEngine.CACHE_TTL })

    return response
  }

  /* ------------------------------ 任务构造 ------------------------------ */

  /** 内置通道：每个启用的平台一个任务 */
  private builtinSearchTasks(
    keyword: string,
    page: number,
    limit: number,
    platforms?: string[]
  ): (() => Promise<PlatformSearchResult>)[] {
    const wanted = platforms && platforms.length > 0 ? new Set(platforms) : null
    return this.providers
      .filter((p) => p.enabled && (!wanted || wanted.has(p.platform)))
      .map((provider) => () => this.runBuiltinProvider(provider, keyword, page, limit))
  }

  /** 音源通道：找出支持 musicSearch 的音源 */
  private async sourceSearchTasks(
    keyword: string,
    page: number,
    limit: number,
    platforms?: string[]
  ): Promise<(() => Promise<PlatformSearchResult>)[]> {
    const wanted = platforms && platforms.length > 0 ? new Set(platforms) : null
    const tasks: (() => Promise<PlatformSearchResult>)[] = []

    for (const src of this.deps.sources.all()) {
      if (src.info.status !== 'ready') continue
      if (!this.deps.sources.isEnabled(src.id)) continue
      if (!src.lxRuntime) continue

      for (const cap of src.info.capabilities) {
        if (!cap.actions.includes('musicSearch')) continue
        if (wanted && !wanted.has(cap.platform)) continue
        const platform = cap.platform
        const sourceId = src.id
        const sourceName = src.info.name
        tasks.push(() => this.runSourceSearch(sourceId, sourceName, platform, keyword, page, limit))
      }
    }
    return tasks
  }

  /* ------------------------------ 执行 ------------------------------ */

  private async runBuiltinProvider(
    provider: SearchProvider,
    keyword: string,
    page: number,
    limit: number
  ): Promise<PlatformSearchResult> {
    const started = Date.now()
    try {
      const res: ProviderSearchResult = await provider.search(keyword, page, limit)
      return {
        platform: provider.platform,
        providerId: provider.id,
        providerName: provider.name,
        songs: res.songs,
        total: res.total,
        isEnd: res.isEnd,
        cost: Date.now() - started
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.deps.onLog?.('warn', 'search', `${provider.name} 搜索失败: ${message}`)
      return {
        platform: provider.platform,
        providerId: provider.id,
        providerName: provider.name,
        songs: [],
        isEnd: true,
        cost: Date.now() - started,
        error: message
      }
    }
  }

  private async runSourceSearch(
    sourceId: string,
    sourceName: string,
    platform: string,
    keyword: string,
    page: number,
    limit: number
  ): Promise<PlatformSearchResult> {
    const started = Date.now()
    const src = this.deps.sources.get(sourceId)
    if (!src?.lxRuntime) {
      return {
        platform,
        providerId: sourceId,
        providerName: sourceName,
        songs: [],
        isEnd: true,
        cost: 0,
        error: '音源不可用'
      }
    }

    try {
      const raw = await src.lxRuntime.dispatch({
        action: 'musicSearch',
        source: platform,
        info: { keyword, page, pagesize: limit, limit }
      })
      const parsed = this.normalizeSourceSearch(raw, platform, sourceId, sourceName)
      return { ...parsed, cost: Date.now() - started }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        platform,
        providerId: sourceId,
        providerName: sourceName,
        songs: [],
        isEnd: true,
        cost: Date.now() - started,
        error: message
      }
    }
  }

  /**
   * 归一音源脚本的 musicSearch 返回。
   * 不同脚本的分页风格差异很大（list / songs / data.list），这里做兼容。
   */
  private normalizeSourceSearch(
    raw: unknown,
    platform: string,
    sourceId: string,
    sourceName: string
  ): Omit<PlatformSearchResult, 'cost'> {
    const container = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const list =
      (container.list as unknown[]) ??
      (container.songs as unknown[]) ??
      ((container.data as Record<string, unknown>)?.list as unknown[]) ??
      []
    const items = Array.isArray(list) ? list : []

    const songs: Song[] = items.map((item, index) => {
      const o = (item ?? {}) as Record<string, any>
      const songmid = String(o.songmid ?? o.hash ?? o.id ?? o.songId ?? o.copyrightId ?? index)
      return {
        id: `${platform}_${songmid}`,
        platform,
        songmid,
        hash: o.hash ? String(o.hash) : undefined,
        songId: o.songId ?? o.id,
        name: String(o.name ?? o.songname ?? o.title ?? '未知歌曲'),
        singer:
          typeof o.singer === 'string'
            ? o.singer
            : Array.isArray(o.singer)
              ? o.singer.map((s: any) => s?.name ?? s).join('/')
              : String(o.singername ?? o.artist ?? '未知歌手'),
        albumName: String(o.albumName ?? o.album ?? o.albumname ?? ''),
        albumId: o.albumId ?? o.album_id,
        duration: Number(o.interval ?? o.duration ?? 0),
        picUrl: o.picUrl ?? o.img ?? o.cover,
        qualities: Array.isArray(o.types) ? o.types.map(String) : ['128k', '320k'],
        channel: 'source',
        providerId: sourceId,
        raw: o
      }
    })

    const isEnd = Boolean(container.isEnd)
    return {
      platform,
      providerId: sourceId,
      providerName: sourceName,
      songs,
      total: typeof container.total === 'number' ? container.total : undefined,
      isEnd
    }
  }

  /** 单平台超时保护：避免某个平台拖住整个搜索 */
  private async runWithTimeout(
    task: () => Promise<PlatformSearchResult>
  ): Promise<PlatformSearchResult> {
    return new Promise<PlatformSearchResult>((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          platform: 'unknown',
          providerId: 'timeout',
          providerName: '超时',
          songs: [],
          isEnd: true,
          cost: APP_CONST.searchTimeout,
          error: `搜索超时 (${APP_CONST.searchTimeout}ms)`
        })
      }, APP_CONST.searchTimeout)

      task()
        .then((res) => {
          clearTimeout(timer)
          resolve(res)
        })
        .catch((err: unknown) => {
          clearTimeout(timer)
          resolve({
            platform: 'unknown',
            providerId: 'error',
            providerName: '异常',
            songs: [],
            isEnd: true,
            cost: 0,
            error: err instanceof Error ? err.message : String(err)
          })
        })
    })
  }

  /**
   * 改版特征词。
   *
   * 用户搜「晴天」时，结果常被 DJ 版 / 伴奏 / 翻唱 / 广场舞版淹没，
   * 原唱反而排在十几条之后。命中这些词就降权，让原唱浮上来。
   */
  private static readonly VARIANT_WORDS = [
    'cover',
    '翻唱',
    '翻自',
    'remix',
    '混音',
    'dj',
    '伴奏',
    'karaoke',
    'ktv',
    'live',
    '现场',
    '演唱会',
    '纯音乐',
    '钢琴',
    '吉他版',
    '古筝',
    '八音盒',
    '抖音',
    '铃声',
    '片段',
    '加速',
    '减速',
    '慢速',
    '降调',
    '升调',
    '女声',
    '男声',
    '童声',
    '方言',
    '串烧',
    'medley',
    'mashup',
    '电音',
    '摇滚版',
    '爵士版',
    '民谣版',
    '合唱版',
    '对唱',
    '消音',
    '原版伴奏',
    '完整版'
  ]

  /**
   * 给单首歌打「原唱可能性」分。
   * 分数只用于排序，不影响展示字段。
   */
  private scoreSong(song: Song, keyword: string): number {
    const kw = keyword.trim().toLowerCase()
    const name = song.name.toLowerCase()
    const singer = song.singer.toLowerCase()
    let score = 0

    // 1) 歌名与关键词的吻合度 —— 最强信号
    if (name === kw) score += 120
    else if (name.startsWith(kw)) score += 70
    else if (name.includes(kw)) score += 30

    // 2) 改版惩罚。命中一个就够，避免多重叠加把正常歌压死
    for (const word of SearchEngine.VARIANT_WORDS) {
      if (name.includes(word)) {
        score -= 80
        break
      }
    }

    // 3) 歌手名命中（用户直接搜「周杰伦」时，这条最管用）
    if (singer.includes(kw)) score += 60

    // 4) 热度：部分平台会带播放量，有就利用（权重压得低，避免平台间不公平）
    const raw = (song.raw ?? {}) as Record<string, unknown>
    const heat = Number(raw.PLAYCNT ?? raw.playCount ?? raw.playcnt ?? 0)
    if (Number.isFinite(heat) && heat > 0) {
      score += Math.min(Math.log10(heat) * 5, 30)
    }

    // 5) 时长过短多半是铃声 / 片段
    if (song.duration > 0 && song.duration < 60) score -= 40

    // 6) 有专辑信息说明是正规发行版本，轻微加分
    if (song.albumName) score += 8

    return score
  }

  /** 对一组结果做原唱优先排序（稳定排序，同分保持平台原序） */
  private rankSongs(songs: Song[], keyword: string): void {
    const scored = songs.map((song, index) => ({
      song,
      index,
      score: this.scoreSong(song, keyword)
    }))
    scored.sort((a, b) => (b.score - a.score) || (a.index - b.index))
    scored.forEach((item, i) => {
      songs[i] = item.song
    })
  }

  /**
   * 用「本机已启用音源」对该平台声明的音质，修正歌曲的可用音质。
   * 这样取流调度器就能一次命中合适的音质，而不必逐级盲试。
   */
  private enrichQualities(song: Song): void {
    const sources = this.deps.sources.findCapable(song.platform, 'musicUrl')
    if (sources.length === 0) return

    const set = new Set<string>()
    for (const src of sources) {
      const cap = src.info.capabilities.find((c) => c.platform === song.platform)
      for (const q of cap?.qualities ?? []) set.add(q)
    }
    if (set.size === 0) return

    song.qualities = [...set].sort((a, b) => qualityRank(b) - qualityRank(a)) as Song['qualities']
  }
}
