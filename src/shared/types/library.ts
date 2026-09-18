/**
 * 本地音乐库类型
 *
 * 「我的喜欢 / 历史播放 / 歌单」三块能力共用这一套数据结构，
 * 统一在主进程持久化，渲染层只做展示与调用。
 */
import type { Song } from './music'

/** 历史播放条目 */
export interface HistoryEntry {
  song: Song
  /** 最近一次播放时间戳 */
  playedAt: number
  /** 累计播放次数 */
  count: number
}

/** 歌单 */
export interface Playlist {
  id: string
  name: string
  songs: Song[]
  createdAt: number
  updatedAt: number
}

/** 音乐库完整快照 */
export interface LibraryData {
  /** 我喜欢的歌曲（按收藏时间倒序） */
  favorites: Song[]
  /** 播放历史（按最近播放倒序） */
  history: HistoryEntry[]
  /** 歌单列表 */
  playlists: Playlist[]
}

/** 歌单操作类型 */
export type PlaylistAction =
  | { type: 'create'; name: string }
  | { type: 'rename'; id: string; name: string }
  | { type: 'remove'; id: string }
  | { type: 'addSongs'; id: string; songs: Song[] }
  | { type: 'removeSongs'; id: string; songIds: string[] }
  | { type: 'clear'; id: string }

/** 音乐库统计（用于侧栏展示） */
export interface LibraryStats {
  favorites: number
  history: number
  playlists: number
}
