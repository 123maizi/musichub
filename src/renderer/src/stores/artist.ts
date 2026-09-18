/**
 * 艺人搜索状态
 *
 * 独立于歌曲搜索：两者的结果结构、使用场景都不一样，
 * 混在一个 store 里会让搜索页的状态机变得很难读。
 *
 * 类型直接从 preload 的 API 推导，省掉一层重复声明。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { cleanIpcError } from '../utils/format'

type ArtistSearchResponse = Awaited<ReturnType<typeof window.api.search.artists>>
type PlatformArtistResult = ArtistSearchResponse['platforms'][number]
export type ArtistInfo = PlatformArtistResult['artists'][number]

export const useArtistStore = defineStore('artist', () => {
  /* ------------------------------ 状态 ------------------------------ */

  const keyword = ref('')
  const loading = ref(false)
  const error = ref<string | null>(null)
  const cost = ref(0)

  /** 各平台的原始结果 */
  const platforms = ref<PlatformArtistResult[]>([])

  /** 当前选中的艺人（进入详情页时用） */
  const selected = ref<ArtistInfo | null>(null)

  /* ------------------------------ 派生 ------------------------------ */

  /**
   * 跨平台合并去重。
   * 同一位艺人在多个平台都有条目，按「平台 + 名字」去重没有必要 ——
   * 保留各自平台的条目反而有用：用户可以选从哪个平台听。
   */
  const allArtists = computed<ArtistInfo[]>(() => {
    const seen = new Set<string>()
    const out: ArtistInfo[] = []
    for (const group of platforms.value) {
      for (const artist of group.artists) {
        if (seen.has(artist.id)) continue
        seen.add(artist.id)
        out.push(artist)
      }
    }
    return out
  })

  /** 有结果的平台数量，用于提示「哪些平台挂了」 */
  const failedPlatforms = computed(() => platforms.value.filter((p) => p.error))

  const total = computed(() => allArtists.value.length)

  /* ------------------------------ 动作 ------------------------------ */

  async function search(nextKeyword?: string): Promise<void> {
    const kw = (nextKeyword ?? keyword.value).trim()
    if (!kw) return

    keyword.value = kw
    loading.value = true
    error.value = null

    try {
      const res = await window.api.search.artists(kw)
      platforms.value = res.platforms
      cost.value = res.cost

      if (total.value === 0) {
        const reasons = res.platforms.filter((p) => p.error).map((p) => `${p.providerName}: ${p.error}`)
        error.value = reasons.length > 0 ? `全部平台返回为空 — ${reasons.join('；')}` : '没有找到相关艺人'
      }
    } catch (err) {
      error.value = cleanIpcError(err)
      platforms.value = []
    } finally {
      loading.value = false
    }
  }

  /** 选一位艺人并进入其详情页 */
  function select(artist: ArtistInfo): void {
    selected.value = artist
  }

  function clear(): void {
    keyword.value = ''
    platforms.value = []
    error.value = null
    cost.value = 0
    selected.value = null
  }

  return {
    keyword,
    loading,
    error,
    cost,
    platforms,
    selected,
    allArtists,
    failedPlatforms,
    total,
    search,
    select,
    clear
  }
})
