/**
 * 专辑搜索状态
 *
 * 与 artist store 同一套结构：专辑搜索是独立链路，
 * 结果形态和使用场景都跟歌曲/艺人不一样，混在一起只会让状态机难读。
 *
 * 类型直接从 preload 的 API 推导，省掉重复声明。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { cleanIpcError } from '../utils/format'

type AlbumSearchResponse = Awaited<ReturnType<typeof window.api.search.albums>>
type PlatformAlbumResult = AlbumSearchResponse['platforms'][number]
export type AlbumInfo = PlatformAlbumResult['albums'][number]

export const useAlbumStore = defineStore('album', () => {
  const keyword = ref('')
  const loading = ref(false)
  const error = ref<string | null>(null)
  const cost = ref(0)
  const platforms = ref<PlatformAlbumResult[]>([])

  /** 跨平台合并去重 */
  const allAlbums = computed<AlbumInfo[]>(() => {
    const seen = new Set<string>()
    const out: AlbumInfo[] = []
    for (const group of platforms.value) {
      for (const album of group.albums) {
        if (seen.has(album.id)) continue
        seen.add(album.id)
        out.push(album)
      }
    }
    return out
  })

  const failedPlatforms = computed(() => platforms.value.filter((p) => p.error))
  const total = computed(() => allAlbums.value.length)

  async function search(nextKeyword?: string): Promise<void> {
    const kw = (nextKeyword ?? keyword.value).trim()
    if (!kw) return

    keyword.value = kw
    loading.value = true
    error.value = null

    try {
      const res = await window.api.search.albums(kw)
      platforms.value = res.platforms
      cost.value = res.cost

      if (total.value === 0) {
        const reasons = res.platforms.filter((p) => p.error).map((p) => `${p.providerName}: ${p.error}`)
        error.value = reasons.length > 0 ? `全部平台返回为空 — ${reasons.join('；')}` : '没有找到相关专辑'
      }
    } catch (err) {
      error.value = cleanIpcError(err)
      platforms.value = []
    } finally {
      loading.value = false
    }
  }

  function clear(): void {
    keyword.value = ''
    platforms.value = []
    error.value = null
    cost.value = 0
  }

  return {
    keyword,
    loading,
    error,
    cost,
    platforms,
    allAlbums,
    failedPlatforms,
    total,
    search,
    clear
  }
})
