/**
 * 专辑相关类型
 *
 * 与艺人搜索同一套思路：独立于歌曲搜索的一条链路，
 * 「专辑」是一个实体（有封面、有歌手、有曲目数），不是一堆歌曲的附带属性。
 */
import type { PlatformId } from './music'

/** 一张专辑 */
export interface AlbumInfo {
  /** 全局唯一 id：`${platform}_${albumId}` */
  id: string
  platform: PlatformId
  /** 平台内的专辑 id（QQ 用 albumMid，其它用数字 id） */
  albumId: string
  /** 专辑名 */
  name: string
  /** 歌手名 */
  singer: string
  /** 封面地址 */
  picUrl?: string
  /** 曲目数 */
  songCount?: number
  /** 发行时间（部分平台有） */
  publishTime?: string
  /** 由哪个 provider 提供 */
  providerId: string
  /** 平台原始字段，便于后续扩展 */
  raw?: Record<string, unknown>
}

/** 单个平台的专辑搜索结果 */
export interface PlatformAlbumResult {
  platform: PlatformId
  providerId: string
  providerName: string
  albums: AlbumInfo[]
  cost: number
  error?: string
}

/** 专辑搜索的聚合响应 */
export interface AlbumSearchResponse {
  keyword: string
  platforms: PlatformAlbumResult[]
  cost: number
}
