/**
 * 音乐领域核心类型
 * 所有平台 / 所有音源的数据，最终都归一到 Song
 */

/** 音乐平台标识（kw/kg/tx/wy/mg 为五大主流平台，local 为本地） */
export type PlatformId = 'kw' | 'kg' | 'tx' | 'wy' | 'mg' | 'local' | (string & {})

/** 音质等级 —— 与洛雪音源协议保持一致 */
export type Quality = '128k' | '320k' | 'flac' | 'flac24bit' | 'hires' | (string & {})

/** 歌曲来源：搜索结果来自哪个搜索通道 */
export type SearchChannel = 'builtin' | 'source'

/**
 * 统一歌曲结构
 *
 * 设计要点：
 * - `songmid` / `hash` 是取流时的关键字段，洛雪音源脚本内部就是 `musicInfo.hash ?? musicInfo.songmid`
 * - `raw` 保存平台原始字段，取流时与归一字段合并后透传给音源脚本，
 *   因为很多音源脚本会读平台私有字段（如 `_types`、`albumId`、`copyrightId`）
 */
export interface Song {
  /** 全局唯一 id：`${platform}_${songmid}` */
  id: string
  /** 所属平台 */
  platform: PlatformId
  /** 平台内歌曲 id（酷狗 hash / QQ songmid / 网易 songmid） */
  songmid: string
  /** 酷我、酷狗使用的 hash */
  hash?: string
  /** 部分接口返回的数字 id */
  songId?: string | number
  /** 歌曲名 */
  name: string
  /** 歌手名（多歌手已用 / 拼接） */
  singer: string
  /** 歌手 id 列表 */
  singerIds?: (string | number)[]
  /** 专辑名 */
  albumName: string
  /** 专辑 id */
  albumId?: string | number
  /** 时长（秒） */
  duration: number
  /** 封面地址 */
  picUrl?: string
  /** 文件大小（字节） */
  fileSize?: number
  /** 该平台可用音质（降序，来自音源脚本上报） */
  qualities: Quality[]
  /** 是否有版权 / 可播放 */
  playable?: boolean
  /** 搜索结果来自哪个搜索通道 */
  channel?: SearchChannel
  /** 由哪个音源/搜索 provider 提供 */
  providerId?: string
  /** 平台原始字段（取流透传用） */
  raw?: Record<string, unknown>
}

/** 单曲播放地址请求 */
export interface MusicUrlRequest {
  song: Song
  /** 期望音质 */
  quality?: Quality
  /** 指定音源 id 列表（按顺序尝试）；为空则自动择优 */
  sourceIds?: string[]
}

/** 播放地址结果 */
export interface MusicUrlResult {
  /** 可直接播放的地址（已过本地代理，规避防盗链/CORS） */
  url: string
  /** 音质 */
  quality: Quality
  /** 实际由哪个音源提供 */
  sourceId: string
  sourceName: string
  /** 是否走了代理 */
  proxied: boolean
  /** 文件扩展名 */
  ext?: string
  /** 文件大小（字节） */
  fileSize?: number
  /** 尝试过的音源及其失败原因 */
  attempts: SourceAttempt[]
}

/** 单个音源的尝试记录 */
export interface SourceAttempt {
  sourceId: string
  sourceName: string
  ok: boolean
  /** 失败原因 */
  error?: string
  /** 耗时 ms */
  cost: number
}

/** 歌词 */
export interface Lyric {
  /** 原始 LRC 歌词 */
  lyric: string
  /** 翻译歌词 */
  tlyric?: string
  /** 罗马音 */
  rlyric?: string
  /** 逐字歌词 */
  lxlyric?: string
  sourceId?: string
}

/** 搜索结果（按平台分组） */
export interface PlatformSearchResult {
  platform: PlatformId
  providerId: string
  providerName: string
  songs: Song[]
  total?: number
  /** 是否已到最后一页 */
  isEnd: boolean
  /** 耗时 ms */
  cost: number
  /** 错误信息（有值表示该平台失败） */
  error?: string
}

/** 多平台聚合搜索结果 */
export interface SearchResponse {
  keyword: string
  page: number
  /** 各平台结果 */
  platforms: PlatformSearchResult[]
  /** 总耗时 ms */
  cost: number
}

/** 搜索请求 */
export interface SearchRequest {
  keyword: string
  /** 要搜索的平台；为空表示全部平台 */
  platforms?: PlatformId[]
  page?: number
  /** 每平台每页条数（默认 30） */
  limit?: number
  /** 搜索通道：builtin=内置接口（默认），source=交给音源脚本自带 search */
  channel?: SearchChannel
}
