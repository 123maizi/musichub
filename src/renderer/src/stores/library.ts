/**
 * 本地音乐库状态（我的喜欢 / 历史播放 / 歌单）
 *
 * 数据真身存在主进程，这里只维护一份内存镜像；
 * 每次变更主进程都会回传完整快照，直接整体替换即可 ——
 * 这类数据量级很小，整体替换比增量合并更不容易出错。
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { Song } from '@shared/types/music'
import type { HistoryEntry, LibraryData, Playlist } from '@shared/types/library'
import { cleanIpcError, formatBytes } from '../utils/format'
import { toPlain } from '../utils/ipc'

export const useLibraryStore = defineStore('library', () => {
  /**
   * 三份列表都用 shallowRef。
   *
   * 主进程每次变更都回传完整快照、这里整体替换（见文件头说明），
   * 从来不原地改某个 song 的字段 —— 深层响应式在这份数据上没有任何收益，
   * 只会给收藏 / 历史 / 歌单里的每一首歌都套一层 Proxy。
   * 收藏与历史可以攒到几百条，这些代理开销是纯粹的白给。
   */
  const favorites = shallowRef<Song[]>([])
  const history = shallowRef<HistoryEntry[]>([])
  const playlists = shallowRef<Playlist[]>([])

  const loading = ref(false)
  const error = ref<string | null>(null)

  /** 收藏 id 集合，用于列表里快速判断是否已收藏 */
  const favoriteIds = computed(() => new Set(favorites.value.map((s) => s.id)))

  const stats = computed(() => ({
    favorites: favorites.value.length,
    history: history.value.length,
    playlists: playlists.value.length
  }))

  /** 整体应用一份快照 */
  function apply(data: LibraryData | undefined): void {
    if (!data) return
    favorites.value = data.favorites ?? []
    history.value = data.history ?? []
    playlists.value = data.playlists ?? []
  }

  async function run(action: () => Promise<LibraryData>): Promise<void> {
    try {
      apply(await action())
      error.value = null
    } catch (err) {
      error.value = cleanIpcError(err)
    }
  }

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      apply(await window.api.library.snapshot())
      error.value = null
    } catch (err) {
      error.value = cleanIpcError(err)
    } finally {
      loading.value = false
    }
  }

  /* ------------------------------ 我的喜欢 ------------------------------ */

  function isFavorite(songId: string): boolean {
    return favoriteIds.value.has(songId)
  }

  /** 切换收藏。注意必须先解包，否则响应式 Proxy 过不了 IPC */
  async function toggleFavorite(song: Song): Promise<void> {
    await run(() => window.api.library.toggleFavorite(toPlain(song)))
  }

  async function clearFavorites(): Promise<void> {
    await run(() => window.api.library.clearFavorites())
  }

  /* ------------------------------ 历史播放 ------------------------------ */

  async function recordPlay(song: Song): Promise<void> {
    await run(() => window.api.library.recordPlay(toPlain(song)))
  }

  async function removeHistory(songIds: string[]): Promise<void> {
    await run(() => window.api.library.removeHistory(songIds))
  }

  async function clearHistory(): Promise<void> {
    await run(() => window.api.library.clearHistory())
  }

  /* ------------------------------ 歌单 ------------------------------ */

  async function createPlaylist(name: string): Promise<void> {
    await run(() => window.api.library.playlist({ type: 'create', name }))
  }

  async function renamePlaylist(id: string, name: string): Promise<void> {
    await run(() => window.api.library.playlist({ type: 'rename', id, name }))
  }

  async function removePlaylist(id: string): Promise<void> {
    await run(() => window.api.library.playlist({ type: 'remove', id }))
  }

  async function addSongsToPlaylist(id: string, songs: Song[]): Promise<void> {
    if (songs.length === 0) return
    await run(() =>
      window.api.library.playlist({ type: 'addSongs', id, songs: songs.map((s) => toPlain(s)) })
    )
  }

  async function removeSongsFromPlaylist(id: string, songIds: string[]): Promise<void> {
    if (songIds.length === 0) return
    await run(() => window.api.library.playlist({ type: 'removeSongs', id, songIds }))
  }

  async function clearPlaylist(id: string): Promise<void> {
    await run(() => window.api.library.playlist({ type: 'clear', id }))
  }

  function getPlaylist(id: string): Playlist | undefined {
    return playlists.value.find((p) => p.id === id)
  }

  return {
    // 状态
    favorites,
    history,
    playlists,
    loading,
    error,
    // 派生
    favoriteIds,
    stats,
    // 读取
    refresh,
    isFavorite,
    getPlaylist,
    // 喜欢
    toggleFavorite,
    clearFavorites,
    // 历史
    recordPlay,
    removeHistory,
    clearHistory,
    // 歌单
    createPlaylist,
    renamePlaylist,
    removePlaylist,
    addSongsToPlaylist,
    removeSongsFromPlaylist,
    clearPlaylist
  }
})

/** 供界面复用的尺寸格式化（历史条目展示用） */
export { formatBytes }
