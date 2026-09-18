/**
 * 音源状态
 * 音源是「能不能听歌」的根，因此这里维护得比别的 store 更细：能力、平台、错误都要看得到。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { SourceImportResult, SourceInfo } from '@shared/types/source'
import { PLATFORM_META } from '@shared/constants'
import { cleanIpcError } from '../utils/format'

export const useSourceStore = defineStore('sources', () => {
  const list = ref<SourceInfo[]>([])
  const loading = ref(false)
  const busy = ref(false)
  const error = ref<string | null>(null)
  /** 最近一次导入结果，用于展示成功/失败明细 */
  const lastImport = ref<SourceImportResult | null>(null)

  const readySources = computed(() => list.value.filter((s) => s.status === 'ready'))
  const enabledSources = computed(() => list.value.filter((s) => s.enabled))
  const errorSources = computed(() => list.value.filter((s) => s.status === 'error'))

  /** 已覆盖的平台（以可用音源为准） */
  const coveredPlatforms = computed(() => {
    const set = new Set<string>()
    for (const src of readySources.value) {
      if (!src.enabled) continue
      for (const p of src.platforms) set.add(p)
    }
    return [...set].map((p) => ({
      id: p,
      name: PLATFORM_META[p]?.name ?? p,
      short: PLATFORM_META[p]?.short ?? p.toUpperCase()
    }))
  })

  /** 支持无损的音源数量 */
  const losslessCount = computed(
    () =>
      readySources.value.filter((s) =>
        s.capabilities.some((c) => c.qualities.some((q) => q === 'flac' || q === 'flac24bit'))
      ).length
  )

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      list.value = await window.api.source.list()
      error.value = null
    } catch (err) {
      error.value = cleanIpcError(err)
    } finally {
      loading.value = false
    }
  }

  /** 统一的导入动作包装：捕捉异常并记录结果 */
  async function runImport(
    action: () => Promise<SourceImportResult>
  ): Promise<SourceImportResult | null> {
    busy.value = true
    error.value = null
    try {
      const result = await action()
      lastImport.value = result
      await refresh()
      return result
    } catch (err) {
      error.value = cleanIpcError(err)
      return null
    } finally {
      busy.value = false
    }
  }

  const importFromDialog = () => runImport(() => window.api.source.importFromDialog())
  const importBundled = () => runImport(() => window.api.source.importBundled())
  const importFromUrl = (url: string) => runImport(() => window.api.source.importFromUrl(url))
  const importFiles = (paths: string[]) =>
    runImport(() => window.api.source.importFiles(paths))

  async function remove(ids: string[]): Promise<void> {
    await window.api.source.remove(ids)
    await refresh()
  }

  async function toggle(id: string, enabled: boolean): Promise<void> {
    const updated = await window.api.source.toggle(id, enabled)
    const idx = list.value.findIndex((s) => s.id === id)
    if (idx >= 0) list.value[idx] = updated
  }

  async function reload(id: string): Promise<void> {
    busy.value = true
    try {
      const updated = await window.api.source.reload(id)
      const idx = list.value.findIndex((s) => s.id === id)
      if (idx >= 0) list.value[idx] = updated
    } catch (err) {
      error.value = cleanIpcError(err)
    } finally {
      busy.value = false
    }
  }

  /** 订阅主进程的音源变更推送，保持列表实时 */
  function bind(): () => void {
    return window.api.on(window.api.events.sourceChanged, (payload: unknown) => {
      list.value = payload as SourceInfo[]
    })
  }

  return {
    list,
    loading,
    busy,
    error,
    lastImport,
    readySources,
    enabledSources,
    errorSources,
    coveredPlatforms,
    losslessCount,
    refresh,
    importFromDialog,
    importBundled,
    importFromUrl,
    importFiles,
    remove,
    toggle,
    reload,
    bind
  }
})
