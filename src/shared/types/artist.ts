/**
 * 艺人（歌手）相关类型
 *
 * 艺人搜索与歌曲搜索是两条独立的链路：
 * 歌曲搜索返回的是可播放条目，艺人搜索返回的是「人」——
 * 有了人才有头像、有作品数量，才能点进去看他的全部歌曲。
 */
import type { PlatformId } from './music'

/** 一位艺人 */
export interface ArtistInfo {
  /** 全局唯一 id：`${platform}_${artistId}` */
  id: string
  platform: PlatformId
  /** 平台内的艺人 id */
  artistId: string
  /** 艺人名 */
  name: string
  /** 别名 / 英文名（部分平台有） */
  alias?: string
  /** 头像地址 */
  picUrl?: string
  /** 歌曲数 */
  songCount?: number
  /** 专辑数 */
  albumCount?: number
  /** 由哪个 provider 提供 */
  providerId: string
  /** 平台原始字段，便于后续扩展 */
  raw?: Record<string, unknown>
}

/** 单个平台的艺人搜索结果 */
export interface PlatformArtistResult {
  platform: PlatformId
  providerId: string
  providerName: string
  artists: ArtistInfo[]
  cost: number
  error?: string
}

/** 艺人搜索的聚合响应 */
export interface ArtistSearchResponse {
  keyword: string
  platforms: PlatformArtistResult[]
  cost: number
}
