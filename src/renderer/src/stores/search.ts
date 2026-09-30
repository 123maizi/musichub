/**
 * 搜索状态
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { PlatformSearchResult, SearchChannel, Song } from '@shared/types/music'
import { PLATFORM_META } from '@shared/constants'
import { cleanIpcError } from '../utils/format'

/** 音源自带搜索通道是否可用由调用方决定，这里只负责跑请求 */
export const useSearchStore = defineStore('search', () => {
  const keyword = ref('')
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * 各平台返回的原始结果。
   *
   * 用 shallowRef 而非 ref：一次搜索会有 140 首歌、每首十来个字段，
   * 深层响应式会给每个 song 对象都套一层 Proxy，模板里每读一次 song.name
   * 都要过一次代理陷阱（140 行 × 十几处读取）。而这批数据从 IPC 拿回来之后
   * 只被整体替换、从不原地修改，浅层引用完全够用 ——
   * 响应性一点没少（赋值照样触发），代理开销全省掉。
   */
  const platforms = shallowRef<PlatformSearchResult[]>([])
  const cost = ref(0)
  const page = ref(1)
  const channel = ref<SearchChannel>('builtin')
  /** 当前查看的平台分组；all 表示合并展示 */
  const activePlatform = ref<string>('all')

  /**
   * 归一化结果缓存。
   *
   * 同一首歌要归一化两次（合并去重一次、打分排序一次），正则替换并不便宜。
   * 缓存之后第二遍直接命中；超过上限整体清空，不会无限涨。
   */
  const normalizeCache = new Map<string, string>()
  const NORMALIZE_CACHE_LIMIT = 4000

  /** 归一化歌名/歌手：剥掉括号后缀，用于跨平台识别「同一首歌」 */
  function normalize(text: string): string {
    const cached = normalizeCache.get(text)
    if (cached !== undefined) return cached

    const result = text
      .replace(/[（(【[].*?[）)】\]]/g, '')
      .replace(/[\s·、,，/]+/g, '')
      .toLowerCase()
      .trim()

    if (normalizeCache.size >= NORMALIZE_CACHE_LIMIT) normalizeCache.clear()
    normalizeCache.set(text, result)
    return result
  }

  /** 改版特征词，与主进程排序规则保持一致 */
  const VARIANT_WORDS = [
    'cover', '翻唱', 'remix', '混音', 'dj', '伴奏', 'karaoke', 'ktv',
    'live', '现场', '演唱会', '纯音乐', '钢琴', '吉他版', '古筝', '抖音',
    '铃声', '片段', '加速', '慢速', '女声', '男声', '童声', '方言',
    '串烧', 'medley', 'mashup', '电音', '合唱版', '完整版'
  ]

  /**
   * 特征词命中检测。
   *
   * 原来是 `VARIANT_WORDS.some(w => name.includes(w))` —— 每首歌要跑 30 次
   * 子串查找，140 首就是 4000+ 次。合成一个正则只扫一遍字符串，语义完全一致
   * （歌名已经 toLowerCase，词表本身也是小写，无需 i 标志）。
   */
  const VARIANT_RE = new RegExp(VARIANT_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'))

  /**
   * 合并后的全部结果（跨平台去重靠 id）
   *
   * 这里额外做一件事：跨平台共识排序。
   * 同一首歌（归一化歌名 + 歌手相同）在越多平台同时出现，就越可能是原唱 ——
   * 翻唱 / DJ 版通常只散落在个别平台。这是单平台内部排序拿不到的信号。
   */
  const allSongs = computed<Song[]>(() => {
    const seen = new Set<string>()
    const merged: Song[] = []
    /** 归一化键 → 命中该曲的平台集合 */
    const platformsOf = new Map<string, Set<string>>()

    for (const group of platforms.value) {
      for (const song of group.songs) {
        if (seen.has(song.id)) continue
        seen.add(song.id)
        merged.push(song)

        const key = `${normalize(song.name)}|${normalize(song.singer)}`
        const bucket = platformsOf.get(key) ?? new Set<string>()
        bucket.add(group.platform)
        platformsOf.set(key, bucket)
      }
    }

    const kw = keyword.value.trim().toLowerCase()

    const scored = merged.map((song, index) => {
      const name = song.name.toLowerCase()
      const singer = song.singer.toLowerCase()
      let score = 0

      if (name === kw) score += 120
      else if (name.startsWith(kw)) score += 70
      else if (name.includes(kw)) score += 30

      if (VARIANT_RE.test(name)) score -= 80
      if (singer.includes(kw)) score += 60

      const key = `${normalize(song.name)}|${normalize(song.singer)}`
      score += ((platformsOf.get(key)?.size ?? 1) - 1) * 25

      if (song.duration > 0 && song.duration < 60) score -= 40
      if (song.albumName) score += 8

      return { song, index, score }
    })

    // 同分时保持原顺序，避免结果跳动
    scored.sort((a, b) => b.score - a.score || a.index - b.index)
    return scored.map((item) => item.song)
  })

  /** 当前展示的歌曲列表 */
  const visibleSongs = computed<Song[]>(() => {
    if (activePlatform.value === 'all') return allSongs.value
    return platforms.value.find((p) => p.platform === activePlatform.value)?.songs ?? []
  })

  /** 平台筛选标签（只有有结果的平台才展示） */
  const platformTabs = computed(() =>
    platforms.value
      .filter((p) => p.songs.length > 0 || p.error)
      .map((p) => ({
        id: p.platform,
        name: PLATFORM_META[p.platform]?.name ?? p.providerName ?? p.platform,
        short: PLATFORM_META[p.platform]?.short ?? p.platform.toUpperCase(),
        count: p.songs.length,
        error: p.error
      }))
  )

  const totalCount = computed(() => allSongs.value.length)

  const failedPlatforms = computed(() => platforms.value.filter((p) => p.error))

  async function search(nextKeyword?: string, resetPage = true): Promise<void> {
    const kw = (nextKeyword ?? keyword.value).trim()
    if (!kw) return

    keyword.value = kw
    if (resetPage) page.value = 1
    loading.value = true
    error.value = null

    try {
      const res = await window.api.search.search({
        keyword: kw,
        page: page.value,
        limit: 30,
        channel: channel.value
      })
      platforms.value = res.platforms
      cost.value = res.cost

      // 之前选中的平台这一页没结果时，自动退回全部
      if (
        activePlatform.value !== 'all' &&
        !res.platforms.some((p) => p.platform === activePlatform.value && p.songs.length > 0)
      ) {
        activePlatform.value = 'all'
      }

      if (totalCount.value === 0) {
        const reasons = res.platforms
          .filter((p) => p.error)
          .map((p) => `${p.providerName}: ${p.error}`)
        error.value = reasons.length > 0 ? `全部平台返回为空 — ${reasons.join('；')}` : '没有找到相关歌曲'
      }
    } catch (err) {
      error.value = cleanIpcError(err)
      platforms.value = []
    } finally {
      loading.value = false
    }
  }

  async function nextPage(): Promise<void> {
    if (loading.value) return
    page.value += 1
    await search(keyword.value, false)
  }

  function clear(): void {
    keyword.value = ''
    platforms.value = []
    error.value = null
    cost.value = 0
    page.value = 1
    activePlatform.value = 'all'
  }

  function setChannel(next: SearchChannel): void {
    channel.value = next
  }

  return {
    keyword,
    loading,
    error,
    platforms,
    cost,
    page,
    channel,
    activePlatform,
    allSongs,
    visibleSongs,
    platformTabs,
    totalCount,
    failedPlatforms,
    search,
    nextPage,
    clear,
    setChannel
  }
})
