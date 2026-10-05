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
import { keywordWantsVariant, titlePurityScore } from '@shared/purity'
import { albumPenalty, artistMatchScore, keywordTokens, normalizeName } from '@shared/originality'
import type { SourceManager } from '../source/manager'
import { builtinProviders, type ProviderSearchResult, type SearchProvider } from './builtin'
// 艺人搜索是独立模块（接口结构完全不同），单独引入，刻意不动已经稳定的 builtin
import { artistSearchers, ARTIST_PLATFORM_NAMES } from './artist'
import type { ArtistInfo, ArtistSearchResponse, PlatformArtistResult } from '@shared/types/artist'
// 专辑搜索同样是独立模块：接口结构与歌曲搜索完全不同
import { albumSearchers, ALBUM_PLATFORM_NAMES } from './album'
import type { AlbumSearchResponse, PlatformAlbumResult } from '@shared/types/album'

export interface SearchEngineDeps {
  sources: SourceManager
  onLog?: (level: 'info' | 'warn' | 'error', scope: string, message: string) => void
}

/**
 * 平台是不是「明确拒绝了」。
 *
 * 国内音乐接口被限流时最典型的回应就是一个 HTML 拦截页，解析 JSON 自然失败，
 * 报错长这样：`Unexpected token '<', "<html>..."`。这类错误必须与普通网络抖动
 * 区别对待 —— 前者要立刻熔断，后者要容错。
 */
function isBlockedResponse(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('unexpected token') ||
    m.includes('<html') ||
    m.includes('<!doctype') ||
    m.includes('is not valid json') ||
    m.includes('invalid json') ||
    // 中文接口有时直接回一段 HTML 提示页，解析里也会出现这个字样
    m.includes('非 json') ||
    m.includes('不是 json')
  )
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

  /**
   * 缓存条数硬上限。
   *
   * 光清「已过期」的项是不够的：用户连着搜几十个不同关键词时，60 条可能全都
   * 还没过期，size 就会一路涨上去 —— 而每条响应装着最多 5 个平台 × 50 首，
   * 每首歌还带着平台原始字段（raw）。这样涨下去主进程内存只增不减，
   * 表现就是「用得越久越吃内存」。
   */
  private static readonly CACHE_MAX = 60

  /**
   * 进行中的相同请求（缓存键 → Promise）。
   *
   * 这是「搜索请求风暴」的根治点。缓存只记「已完成」的结果，所以同一个 key 的
   * 并发调用在首个请求返回之前**全部 miss**，于是每一个都真打一遍平台。
   * 真实日志里的形态很典型：酷我的失败日志成对出现、每 300~400ms 一组 ——
   * 同一次用户操作在短时间内叠了好几条相同搜索（搜索页 + 艺人页 + 专辑页
   * 都会调 song search），每条都独立打向平台，平台反手给 HTML 拦截页，
   * 之后越打越失败，日志被刷屏。
   *
   * 现在同一 key 的并发调用共享同一个 Promise，平台侧只看到一次请求。
   */
  private readonly inflightSearch = new Map<string, Promise<SearchResponse>>()

  /** 艺人 / 专辑搜索的进行中请求（同样是「一次操作打多遍」的重灾区） */
  private readonly inflightAux = new Map<string, Promise<unknown>>()

  /**
   * 平台级熔断状态：platform → 连续失败次数 / 冷却截止 / 最近原因。
   *
   * 拿到 HTML 拦截页时不必攒次数，直接冷却 60 秒 —— 那是平台明确在拒绝，
   * 继续请求只会把限流打成持续失败。普通网络抖动则要连续失败 3 次才冷却，
   * 免得一次超时就把平台关了。冷却到点自动恢复，能力一点没少。
   */
  private readonly platformHealth = new Map<
    string,
    { strikes: number; until: number; reason: string }
  >()

  private static readonly PLATFORM_COOLDOWN_MS = 60_000
  private static readonly PLATFORM_COOLDOWN_SOFT_MS = 20_000
  /**
   * 触发熔断需要连续失败几次。
   *
   * 拦截页要 2 次：一次「Unexpected token」也可能只是偶发的网关抖动，
   * 一次就关平台等于拿功能换安静 —— 而这是明令不许的。
   * 普通网络错误要 3 次，容错更宽。
   */
  private static readonly PLATFORM_BLOCKED_STRIKES = 2
  private static readonly PLATFORM_STRIKE_LIMIT = 3

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

  /** 进程退出前释放（缓存里是整包响应，属于该主动交还的内存） */
  dispose(): void {
    this.cache.clear()
    this.inflightSearch.clear()
    this.inflightAux.clear()
    this.platformHealth.clear()
  }

  /** 当前缓存条数（诊断/验证用） */
  get cacheSize(): number {
    return this.cache.size
  }

  /**
   * 同一 key 的并发调用只真正执行一次，其余复用同一个 Promise。
   * 执行结束后立刻从表里摘掉，不占内存、也不会让后续请求拿到过期结果。
   */
  private dedupe<T>(store: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
    const running = store.get(key)
    if (running) return running
    const task = run()
    store.set(key, task)
    const clear = (): void => {
      if (store.get(key) === task) store.delete(key)
    }
    task.then(clear, clear)
    return task
  }

  /** 该平台是否处于冷却期；返回一句人话说明，或 null 表示可以正常请求 */
  private cooldownReason(platform: string): string | null {
    const state = this.platformHealth.get(platform)
    if (!state || state.until <= Date.now()) return null
    const left = Math.ceil((state.until - Date.now()) / 1000)
    return `已连续失败 ${state.strikes} 次（${state.reason}），${left} 秒后自动恢复`
  }

  /** 记录一次平台成功：连续失败清零并解除冷却 */
  private markPlatformOk(platform: string): void {
    const state = this.platformHealth.get(platform)
    if (!state) return
    if (state.until > Date.now()) {
      this.deps.onLog?.('info', 'search', `平台 ${platform} 已恢复，重新参与搜索`)
    }
    this.platformHealth.delete(platform)
  }

  /** 记录一次平台失败：判断是否该熔断 */
  private markPlatformFail(platform: string, name: string, message: string): void {
    const state = this.platformHealth.get(platform) ?? { strikes: 0, until: 0, reason: '' }
    state.strikes += 1
    state.reason = message.slice(0, 60)

    if (isBlockedResponse(message)) {
      // HTML 拦截页 / 解析失败：平台明确在拒绝，连续两次就冷却，别再火上浇油
      if (state.strikes >= SearchEngine.PLATFORM_BLOCKED_STRIKES) {
        state.until = Date.now() + SearchEngine.PLATFORM_COOLDOWN_MS
      }
    } else if (state.strikes >= SearchEngine.PLATFORM_STRIKE_LIMIT) {
      state.until = Date.now() + SearchEngine.PLATFORM_COOLDOWN_SOFT_MS
    }

    this.platformHealth.set(platform, state)

    if (state.until > Date.now()) {
      this.deps.onLog?.(
        'warn',
        'search',
        `${name} 暂停 ${Math.round((state.until - Date.now()) / 1000)} 秒不再请求（连续失败 ${state.strikes} 次：${state.reason}）`
      )
    }
  }

  /**
   * 淘汰：先清过期项，再对超出硬上限的部分按写入顺序（= 过期顺序）淘汰最旧的。
   * 有硬上限在，cache.size 永远不会无限增长。
   */
  private pruneCache(): void {
    const now = Date.now()
    for (const [k, v] of this.cache) {
      if (v.expireAt <= now) this.cache.delete(k)
    }
    while (this.cache.size > SearchEngine.CACHE_MAX) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
  }

  /* ------------------------------ 艺人搜索 ------------------------------ */

  /**
   * 艺人搜索：五个平台并发，单平台失败不影响其它平台。
   * 与歌曲搜索是两条独立链路，也不共用缓存。
   */
  async searchArtists(keyword: string, platforms?: string[]): Promise<ArtistSearchResponse> {
    const started = Date.now()
    const kw = (keyword ?? '').trim()
    if (!kw) return { keyword: kw, platforms: [], cost: 0 }

    const wanted = platforms && platforms.length > 0 ? new Set(platforms) : null
    const targets = Object.entries(artistSearchers).filter(([id]) => !wanted || wanted.has(id))
    const dedupeKey = `artist|${kw}|${[...(wanted ?? [])].sort().join(',')}`

    return this.dedupe(this.inflightAux, dedupeKey, async () => {
      const settled: PlatformArtistResult[] = await Promise.all(
        targets.map(async ([id, searcher]): Promise<PlatformArtistResult> => {
          const t0 = Date.now()
          const providerName = ARTIST_PLATFORM_NAMES[id] ?? id
          try {
            const artists = await searcher(kw, 1, 15)
            return { platform: id, providerId: id, providerName, artists, cost: Date.now() - t0 }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            this.deps.onLog?.('warn', 'search', `艺人搜索失败 ${providerName}: ${message}`)
            return {
              platform: id,
              providerId: id,
              providerName,
              artists: [],
              cost: Date.now() - t0,
              error: message
            }
          }
        })
      )

      // 每个平台内部排序：同名艺人很多，需要把「主流的那位」顶上来
      for (const group of settled) {
        group.artists = group.artists
          .map((artist, index) => ({ artist, index, score: this.scoreArtist(artist, kw) }))
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .map((item) => item.artist)
      }

      return { keyword: kw, platforms: settled, cost: Date.now() - started }
    }) as Promise<ArtistSearchResponse>
  }

  /**
   * 艺人排序打分。
   *
   * 完全同名的优先；其次看作品数量 —— 这是判断「谁才是那个主流歌手」
   * 最有效的信号，同名的小号作品数通常只有个位数。
   */
  private scoreArtist(artist: ArtistInfo, keyword: string): number {
    const kw = keyword.trim().toLowerCase()
    const name = artist.name.toLowerCase()
    let score = 0

    if (name === kw) score += 100
    else if (name.includes(kw)) score += 40

    if (artist.songCount && artist.songCount > 0) {
      score += Math.min(Math.log10(artist.songCount) * 20, 60)
    }
    if (artist.albumCount && artist.albumCount > 0) {
      score += Math.min(Math.log10(artist.albumCount) * 10, 20)
    }
    // 有头像通常意味着平台收录更完整，轻微加分
    if (artist.picUrl) score += 5

    return score
  }

  /* ------------------------------ 专辑搜索 ------------------------------ */

  /**
   * 专辑搜索：四个平台并发。
   * （QQ 那个 t=2 接口的响应里已不再包含专辑列表，故未接入。）
   */
  async searchAlbums(keyword: string, platforms?: string[]): Promise<AlbumSearchResponse> {
    const started = Date.now()
    const kw = (keyword ?? '').trim()
    if (!kw) return { keyword: kw, platforms: [], cost: 0 }

    const wanted = platforms && platforms.length > 0 ? new Set(platforms) : null
    const targets = Object.entries(albumSearchers).filter(([id]) => !wanted || wanted.has(id))
    const dedupeKey = `album|${kw}|${[...(wanted ?? [])].sort().join(',')}`

    return this.dedupe(this.inflightAux, dedupeKey, async () => {
      const settled: PlatformAlbumResult[] = await Promise.all(
        targets.map(async ([id, searcher]): Promise<PlatformAlbumResult> => {
          const t0 = Date.now()
          const providerName = ALBUM_PLATFORM_NAMES[id] ?? id
          try {
            const albums = await searcher(kw, 1, 15)
            return { platform: id, providerId: id, providerName, albums, cost: Date.now() - t0 }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            this.deps.onLog?.('warn', 'search', `专辑搜索失败 ${providerName}: ${message}`)
            return {
              platform: id,
              providerId: id,
              providerName,
              albums: [],
              cost: Date.now() - t0,
              error: message
            }
          }
        })
      )

      // 专辑名完全匹配的排前面，其次曲目多的（通常意味着正式专辑而非单曲）
      for (const group of settled) {
        group.albums = group.albums
          .map((album, index) => ({ album, index, score: this.scoreAlbum(album, kw) }))
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .map((item) => item.album)
      }

      return { keyword: kw, platforms: settled, cost: Date.now() - started }
    }) as Promise<AlbumSearchResponse>
  }

  /** 专辑排序打分：同名优先，其次看曲目数 */
  private scoreAlbum(album: PlatformAlbumResult['albums'][number], keyword: string): number {
    const kw = keyword.trim().toLowerCase()
    const name = album.name.toLowerCase()
    let score = 0

    if (name === kw) score += 100
    else if (name.includes(kw)) score += 40

    if (album.songCount && album.songCount > 0) {
      score += Math.min(Math.log10(album.songCount) * 25, 50)
    }
    if (album.picUrl) score += 8
    if (album.singer) score += 5

    return score
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
    const keyword = (req.keyword ?? '').trim()
    const page = req.page && req.page > 0 ? req.page : 1
    const limit = req.limit && req.limit > 0 ? Math.min(req.limit, 50) : 30

    if (!keyword) {
      return { keyword, page, platforms: [], cost: 0 }
    }

    const channel = req.channel ?? 'builtin'
    const key = this.cacheKey(keyword, page, channel, req.platforms)

    // 命中缓存直接返回，省掉五个平台的并发请求
    const cached = this.cache.get(key)
    if (cached && Date.now() < cached.expireAt) {
      return { ...cached.response, cost: 0 }
    }

    /**
     * 进行中请求去重。
     *
     * 放在缓存之后、真正执行之前：第一个调用者去执行，其余调用者挂到同一个
     * Promise 上。这样「同一次用户操作叠了好几条相同搜索」只会向平台发一次请求。
     * 返回浅拷贝，避免多个调用者共享同一个顶层对象。
     */
    const running = this.inflightSearch.get(key)
    if (running) return running.then((shared) => ({ ...shared }))

    const task = this.executeSearch(keyword, page, limit, channel, req.platforms)
    this.inflightSearch.set(key, task)
    const clear = (): void => {
      if (this.inflightSearch.get(key) === task) this.inflightSearch.delete(key)
    }
    task.then(clear, clear)
    return task
  }

  /**
   * 真正执行一次聚合搜索（缓存与去重之后的落点）。
   * 从 search() 里拆出来只是为了给去重让路，逻辑与拆分前一致。
   */
  private async executeSearch(
    keyword: string,
    page: number,
    limit: number,
    channel: string,
    platforms?: string[]
  ): Promise<SearchResponse> {
    const started = Date.now()

    const tasks =
      channel === 'source'
        ? await this.sourceSearchTasks(keyword, page, limit, platforms)
        : this.builtinSearchTasks(keyword, page, limit, platforms)

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

    // 写入缓存（顺手淘汰：过期项 + 超出硬上限的最旧项）
    this.cache.set(this.cacheKey(keyword, page, channel, platforms), {
      response,
      expireAt: Date.now() + SearchEngine.CACHE_TTL
    })
    this.pruneCache()

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

    /**
     * 平台冷却检查放在发请求之前。
     *
     * 被限流的平台再打也是白打 —— 既拿不到数据，还会把「偶发限流」拖成
     * 「持续失败」。直接返回空结果 + 说明，界面照旧显示该平台，
     * 冷却到点自动恢复，能力没有少。
     */
    const cooling = this.cooldownReason(provider.platform)
    if (cooling) {
      return {
        platform: provider.platform,
        providerId: provider.id,
        providerName: provider.name,
        songs: [],
        isEnd: true,
        cost: 0,
        error: `${provider.name} 暂时跳过：${cooling}`
      }
    }

    try {
      const res: ProviderSearchResult = await provider.search(keyword, page, limit)
      this.markPlatformOk(provider.platform)
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
      this.markPlatformFail(provider.platform, provider.name, message)
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
   * 给单首歌打「原唱可能性」分。
   * 分数只用于排序，不影响展示字段。
   */
  private scoreSong(song: Song, keyword: string, wantsVariant: boolean): number {
    const tokens = keywordTokens(keyword)
    const kw = normalizeName(keyword)
    const name = normalizeName(song.name)
    let score = 0

    /**
     * 1) **歌手字段 —— 权重最高的信号**
     *
     * 为什么歌手比歌名可靠：DJ 版同样可以把歌名写成《晴天》，
     * 但歌手字段很难伪装成「周杰伦」。
     *
     * 原来的实现拿**整个关键词**去 `singer.includes(kw)`，用户搜「周杰伦 晴天」时
     * 歌名和歌手字段都不含这一整串，两边全部匹配不上 —— 等于这个最强信号根本没用上。
     * 这里改成先拆片段、再逐片段比对，并对繁简 / 括号 / 别名做归一。
     */
    let artistBest = 0
    for (const token of tokens) {
      const hit = artistMatchScore(song.singer, token)
      if (hit > artistBest) artistBest = hit
    }
    score += artistBest

    // 2) 歌名吻合度：任一关键词片段命中即可（多词搜索时不再要求整串命中）
    let titleBest = 0
    for (const token of tokens) {
      if (name === token) titleBest = Math.max(titleBest, 120)
      else if (name.startsWith(token)) titleBest = Math.max(titleBest, 70)
      else if (name.includes(token)) titleBest = Math.max(titleBest, 30)
    }
    if (tokens.length === 0 && kw) {
      if (name === kw) titleBest = 120
      else if (name.startsWith(kw)) titleBest = 70
      else if (name.includes(kw)) titleBest = 30
    }
    score += titleBest

    /**
     * 3) 标题纯净度（见 @shared/purity）：**辅助项**。
     *    干净的名字加分，带 DJ / 伴奏 / 变速 / 烟嗓这类后缀的扣分。
     *    它只能做辅助 —— 有些原唱的歌名本身就带后缀（《晴天 (Live)》是官方发行的 Live），
     *    所以不能让它单独决定排序。用户专门搜改版时整套惩罚不生效。
     */
    if (!wantsVariant) score += titlePurityScore(song.name)

    // 4) 专辑字段交叉验证：有专辑说明是正规发行；落在合集/精选/抖音这类则减分
    if (song.albumName) score += 8
    if (!wantsVariant) score += albumPenalty(song.albumName)

    // 5) 热度兜底：部分平台会带播放量，有就用（权重压得低，避免平台间不公平）
    const raw = (song.raw ?? {}) as Record<string, unknown>
    const heat = Number(raw.PLAYCNT ?? raw.playCount ?? raw.playcnt ?? 0)
    if (Number.isFinite(heat) && heat > 0) {
      score += Math.min(Math.log10(heat) * 5, 30)
    }

    // 6) 时长过短多半是铃声 / 片段
    if (song.duration > 0 && song.duration < 60) score -= 40

    return score
  }

  /** 对一组结果做原唱优先排序（稳定排序，同分保持平台原序） */
  private rankSongs(songs: Song[], keyword: string): void {
    // 用户在专门找改版（搜索词里自带 DJ/伴奏 之类）时，整套纯净度惩罚不参与
    const wantsVariant = keywordWantsVariant(keyword)
    const scored = songs.map((song, index) => ({
      song,
      index,
      score: this.scoreSong(song, keyword, wantsVariant)
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
