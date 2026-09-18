/**
 * 本地音乐库服务
 *
 * 「我的喜欢 / 历史播放 / 歌单」的统一持久化出口。
 * 刻意不做分页与增量：这类数据量级很小（几千首封顶），
 * 一次性读进内存反而让上下两层的逻辑都最简单。
 */
import { randomUUID } from 'node:crypto'

import type { Song } from '@shared/types/music'
import type {
  HistoryEntry,
  LibraryData,
  LibraryStats,
  Playlist,
  PlaylistAction
} from '@shared/types/library'
import { JsonStore } from './store'

/** 历史记录上限，超出后丢弃最旧的 */
const HISTORY_LIMIT = 500

/** 收藏上限保护：防止手滑批量收藏把配置文件撑爆 */
const FAVORITES_LIMIT = 5000

/** 歌单内单曲上限 */
const PLAYLIST_SONG_LIMIT = 5000

const EMPTY_LIBRARY: LibraryData = {
  favorites: [],
  history: [],
  playlists: []
}

export class LibraryService {
  private readonly store: JsonStore<LibraryData>

  constructor(filePath: string) {
    // 防抖稍长：收藏/记录历史都是高频动作，没必要每次都落盘
    this.store = new JsonStore<LibraryData>(filePath, EMPTY_LIBRARY, { debounceMs: 600 })
  }

  /* ------------------------------ 读取 ------------------------------ */

  snapshot(): LibraryData {
    return this.store.get()
  }

  stats(): LibraryStats {
    const data = this.store.get()
    return {
      favorites: data.favorites.length,
      history: data.history.length,
      playlists: data.playlists.length
    }
  }

  isFavorite(songId: string): boolean {
    return this.store.get().favorites.some((song) => song.id === songId)
  }

  /** 找出包含该歌曲的所有歌单 id（UI 上打勾用） */
  playlistsContaining(songId: string): string[] {
    return this.store
      .get()
      .playlists.filter((p) => p.songs.some((s) => s.id === songId))
      .map((p) => p.id)
  }

  /* ------------------------------ 我喜欢 ------------------------------ */

  /** 切换收藏状态，返回变更后的快照 */
  toggleFavorite(song: Song): LibraryData {
    const data = this.store.get()
    const exists = data.favorites.some((s) => s.id === song.id)

    if (exists) {
      return this.store.set({ favorites: data.favorites.filter((s) => s.id !== song.id) })
    }
    // 新收藏放在最前，用户最近喜欢的先看到
    return this.store.set({
      favorites: [song, ...data.favorites].slice(0, FAVORITES_LIMIT)
    })
  }

  clearFavorites(): LibraryData {
    return this.store.set({ favorites: [] })
  }

  /* ------------------------------ 历史播放 ------------------------------ */

  /**
   * 记录一次播放。
   * 同一首歌重复播放只更新时间与次数、不重复占位，否则历史会被刷屏。
   */
  recordPlay(song: Song): LibraryData {
    const data = this.store.get()
    const now = Date.now()
    const previous = data.history.find((h) => h.song.id === song.id)

    const entry: HistoryEntry = previous
      ? { song, playedAt: now, count: previous.count + 1 }
      : { song, playedAt: now, count: 1 }

    const rest = data.history.filter((h) => h.song.id !== song.id)
    return this.store.set({ history: [entry, ...rest].slice(0, HISTORY_LIMIT) })
  }

  removeHistory(songIds: string[]): LibraryData {
    const drop = new Set(songIds)
    return this.store.set({
      history: this.store.get().history.filter((h) => !drop.has(h.song.id))
    })
  }

  clearHistory(): LibraryData {
    return this.store.set({ history: [] })
  }

  /* ------------------------------ 歌单 ------------------------------ */

  playlist(action: PlaylistAction): LibraryData {
    const data = this.store.get()
    const now = Date.now()

    switch (action.type) {
      case 'create': {
        const created: Playlist = {
          id: randomUUID(),
          name: action.name.trim() || '新建歌单',
          songs: [],
          createdAt: now,
          updatedAt: now
        }
        return this.store.set({ playlists: [...data.playlists, created] })
      }

      case 'rename': {
        const name = action.name.trim()
        return this.store.set({
          playlists: data.playlists.map((p) =>
            p.id === action.id ? { ...p, name: name || p.name, updatedAt: now } : p
          )
        })
      }

      case 'remove': {
        return this.store.set({
          playlists: data.playlists.filter((p) => p.id !== action.id)
        })
      }

      case 'addSongs': {
        return this.store.set({
          playlists: data.playlists.map((p) => {
            if (p.id !== action.id) return p
            // 歌单内按 id 去重，避免同一首歌反复加入
            const existing = new Set(p.songs.map((s) => s.id))
            const incoming = action.songs.filter((s) => !existing.has(s.id))
            return {
              ...p,
              songs: [...p.songs, ...incoming].slice(0, PLAYLIST_SONG_LIMIT),
              updatedAt: now
            }
          })
        })
      }

      case 'removeSongs': {
        const drop = new Set(action.songIds)
        return this.store.set({
          playlists: data.playlists.map((p) =>
            p.id === action.id
              ? { ...p, songs: p.songs.filter((s) => !drop.has(s.id)), updatedAt: now }
              : p
          )
        })
      }

      case 'clear': {
        return this.store.set({
          playlists: data.playlists.map((p) =>
            p.id === action.id ? { ...p, songs: [], updatedAt: now } : p
          )
        })
      }

      default:
        return data
    }
  }

  /* ------------------------------ 生命周期 ------------------------------ */

  /** 进程退出前强制落盘 */
  dispose(): void {
    this.store.flush()
  }
}
