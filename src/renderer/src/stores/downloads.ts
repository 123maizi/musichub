/**
 * 下载状态
 * 进度由主进程推送（事件驱动），避免前端轮询造成无谓开销。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { DownloadConfig, DownloadTask } from '@shared/types/download'
import type { Quality, Song } from '@shared/types/music'
import { cleanIpcError } from '../utils/format'
import { addDownload } from '../utils/ipc'

export const useDownloadStore = defineStore('downloads', () => {
  const tasks = ref<DownloadTask[]>([])
  const config = ref<DownloadConfig | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const activeTasks = computed(() =>
    tasks.value.filter((t) => t.status === 'downloading' || t.status === 'pending' || t.status === 'waiting')
  )
  const finishedTasks = computed(() => tasks.value.filter((t) => t.status === 'done'))
  const failedTasks = computed(() => tasks.value.filter((t) => t.status === 'error'))

  /** 总体进度（用于任务栏进度条 / 概览） */
  const overallProgress = computed(() => {
    const running = activeTasks.value
    if (running.length === 0) return 0
    const sum = running.reduce((acc, t) => acc + (t.total > 0 ? t.progress : 0), 0)
    return sum / running.length
  })

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      tasks.value = await window.api.download.list()
      error.value = null
    } catch (err) {
      error.value = cleanIpcError(err)
    } finally {
      loading.value = false
    }
  }

  async function loadConfig(): Promise<void> {
    try {
      config.value = await window.api.download.getConfig()
    } catch (err) {
      error.value = cleanIpcError(err)
    }
  }

  async function setConfig(patch: Partial<DownloadConfig>): Promise<void> {
    try {
      config.value = await window.api.download.setConfig(patch)
    } catch (err) {
      error.value = cleanIpcError(err)
    }
  }

  async function chooseDir(): Promise<void> {
    const dir = await window.api.download.chooseDir()
    if (dir) await loadConfig()
  }

  /** 加入下载队列 */
  async function add(songs: Song[], options: { quality?: Quality; writeTag?: boolean } = {}): Promise<void> {
    if (songs.length === 0) return
    error.value = null
    try {
      const created = await addDownload({
        songs,
        quality: options.quality,
        writeTag: options.writeTag
      })
      // 立即插入本地列表，不等推送，交互更跟手
      tasks.value = [...created, ...tasks.value]
    } catch (err) {
      error.value = cleanIpcError(err)
    }
  }

  async function pause(ids: string[]): Promise<void> {
    await window.api.download.pause(ids)
  }

  async function resume(ids: string[]): Promise<void> {
    await window.api.download.resume(ids)
  }

  async function retry(ids: string[]): Promise<void> {
    await window.api.download.retry(ids)
  }

  async function remove(ids: string[], deleteFile = false): Promise<void> {
    await window.api.download.remove(ids, deleteFile)
    tasks.value = tasks.value.filter((t) => !ids.includes(t.id))
  }

  async function clearFinished(): Promise<void> {
    await window.api.download.clearFinished()
    tasks.value = tasks.value.filter((t) => t.status !== 'done')
  }

  /** 就地更新单个任务（进度推送高频，避免整表重建） */
  function upsert(task: DownloadTask): void {
    const idx = tasks.value.findIndex((t) => t.id === task.id)
    if (idx >= 0) tasks.value[idx] = task
    else tasks.value = [task, ...tasks.value]
  }

  function bind(): () => void {
    const offProgress = window.api.on(window.api.events.downloadProgress, (payload: unknown) => {
      upsert(payload as DownloadTask)
    })
    const offDone = window.api.on(window.api.events.downloadDone, (payload: unknown) => {
      upsert(payload as DownloadTask)
    })
    const offError = window.api.on(window.api.events.downloadError, (payload: unknown) => {
      upsert(payload as DownloadTask)
    })
    return () => {
      offProgress()
      offDone()
      offError()
    }
  }

  return {
    tasks,
    config,
    loading,
    error,
    activeTasks,
    finishedTasks,
    failedTasks,
    overallProgress,
    refresh,
    loadConfig,
    setConfig,
    chooseDir,
    add,
    pause,
    resume,
    retry,
    remove,
    clearFinished,
    bind
  }
})
