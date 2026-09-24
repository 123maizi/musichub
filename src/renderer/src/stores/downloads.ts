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

  /**
   * 已完成但磁盘上找不到文件的任务 id 集合。
   *
   * 这类任务的「已完成」是假的 —— 文件可能被同名任务覆盖过、被清理过。
   * 不标出来的话，用户点播放只会得到一个没头没尾的失败。
   */
  const missingFiles = ref<Set<string>>(new Set())

  async function audit(): Promise<void> {
    try {
      const result = await window.api.download.audit()
      const next = new Set<string>()
      for (const task of tasks.value) {
        if (task.status !== 'done') continue
        const state = result?.[task.id]
        if (state && (!state.exists || state.suspicious)) next.add(task.id)
      }
      missingFiles.value = next
    } catch {
      /* 体检失败不影响主流程 */
    }
  }

  function markMissing(id: string, missing: boolean): void {
    const next = new Set(missingFiles.value)
    if (missing) next.add(id)
    else next.delete(id)
    missingFiles.value = next
  }

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
      await audit()
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

  /** 切换下载格式。就是改 preferQuality，取流层直接按这个档位要流。 */
  async function setFormat(quality: Quality): Promise<void> {
    await setConfig({ preferQuality: quality })
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
    missingFiles,
    activeTasks,
    finishedTasks,
    failedTasks,
    overallProgress,
    refresh,
    audit,
    markMissing,
    setFormat,
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
