/**
 * 播放器状态中枢
 *
 * 播放地址一律通过 IPC 从主进程取（音源择优在那边完成），
 * 渲染层只负责驱动 <audio> 与维护播放列表。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Lyric, MusicUrlResult, Quality, Song } from '@shared/types/music'
import { cleanIpcError, findLyricIndex, parseLrc, type LyricLine } from '../utils/format'
import { getLyric as fetchLyric, getPlayUrl } from '../utils/ipc'
import { useLibraryStore } from './library'

/** 播放模式 */
export type PlayMode = 'order' | 'loop' | 'single' | 'shuffle'

export const usePlayerStore = defineStore('player', () => {
  /* ------------------------------ 状态 ------------------------------ */

  const playlist = ref<Song[]>([])
  const currentIndex = ref(-1)
  const current = ref<Song | null>(null)

  const playing = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const currentTime = ref(0)
  /**
   * 音频元素上报的时长。
   * 很多音源的流不带 Content-Length，此时 el.duration 会是 NaN 或 Infinity，
   * 因此不能直接拿它当时长用。
   */
  const mediaDuration = ref(0)
  const volume = ref(0.8)

  const quality = ref<Quality>('320k')
  const mode = ref<PlayMode>('order')
  /** 本次播放实际命中的音源（UI 上展示，让用户知道歌是从哪来的） */
  const urlInfo = ref<MusicUrlResult | null>(null)
  const attempts = ref<MusicUrlResult['attempts']>([])

  const lyricRaw = ref<Lyric | null>(null)
  const lyricLines = ref<LyricLine[]>([])

  let audio: HTMLAudioElement | null = null

  /* ------------------------------ 派生 ------------------------------ */

  /**
   * 进度计算用的时长。
   *
   * 优先用音频元素上报的值；拿不到就退回歌曲元数据里的时长。
   * 之前「进度条不走」的根因就在这里：音源不上报时长时，
   * durationchange 会把时长覆盖成 0，进度于是永远停在 0%。
   */
  const duration = computed(() => {
    const media = mediaDuration.value
    if (Number.isFinite(media) && media > 0) return media
    return current.value?.duration ?? 0
  })

  const progress = computed(() =>
    duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0
  )

  const currentLyricIndex = computed(() => findLyricIndex(lyricLines.value, currentTime.value))

  const hasLyric = computed(() => lyricLines.value.length > 0)

  /* ------------------------------ 音频实例 ------------------------------ */

  function ensureAudio(): HTMLAudioElement {
    if (audio) return audio

    const el = new Audio()
    el.preload = 'auto'
    el.volume = volume.value

    /**
     * 同步时长。
     * 关键：只有拿到有效值才写入 —— 之前这里会把 NaN / Infinity 直接写成 0，
     * 导致进度条永远停在起点。
     */
    const syncDuration = (): void => {
      const value = el.duration
      if (Number.isFinite(value) && value > 0) mediaDuration.value = value
    }

    el.addEventListener('timeupdate', () => {
      currentTime.value = el.currentTime
      // 顺带兜底：有些音源要播一会儿才报出真实时长
      syncDuration()
    })
    el.addEventListener('loadedmetadata', syncDuration)
    el.addEventListener('durationchange', syncDuration)
    el.addEventListener('progress', syncDuration)
    el.addEventListener('play', () => {
      playing.value = true
    })
    el.addEventListener('pause', () => {
      playing.value = false
    })
    el.addEventListener('ended', () => {
      void handleEnded()
    })
    el.addEventListener('error', () => {
      // 地址失效是多音源场景下最常见的问题，给出可行动的提示
      error.value = '播放失败：该音源地址已失效，换首歌或切换音源试试'
      playing.value = false
      loading.value = false
    })

    audio = el
    return el
  }

  /* ------------------------------ 播放控制 ------------------------------ */

  /** 播放指定歌曲；传入 list 时会替换整个播放队列 */
  async function play(song: Song, list?: Song[]): Promise<void> {
    if (list && list.length > 0) {
      playlist.value = [...list]
      currentIndex.value = list.findIndex((s) => s.id === song.id)
    } else if (playlist.value.length === 0) {
      playlist.value = [song]
      currentIndex.value = 0
    }

    current.value = song
    loading.value = true
    error.value = null
    urlInfo.value = null
    attempts.value = []
    lyricLines.value = []
    lyricRaw.value = null
    currentTime.value = 0
    // 重置音频上报的时长，真实值会在加载与播放过程中补上
    mediaDuration.value = 0

    try {
      const result = await getPlayUrl({ song, quality: quality.value })
      urlInfo.value = result
      attempts.value = result.attempts ?? []

      const el = ensureAudio()
      el.src = result.url
      await el.play()
      playing.value = true

      // 歌词是锦上添花，失败了不打扰用户
      void loadLyric(song)
      // 记录播放历史；写库失败绝不该影响播放本身
      void useLibraryStore()
        .recordPlay(song)
        .catch(() => undefined)
    } catch (err) {
      error.value = cleanIpcError(err)
      playing.value = false
    } finally {
      loading.value = false
    }
  }

  /** 取歌词 */
  async function loadLyric(song: Song): Promise<void> {
    try {
      const lyric = await fetchLyric(song)
      if (!lyric || current.value?.id !== song.id) return
      lyricRaw.value = lyric
      const main = lyric.lyric || lyric.lxlyric || ''
      lyricLines.value = parseLrc(main)
    } catch {
      lyricLines.value = []
    }
  }

  function pause(): void {
    audio?.pause()
    playing.value = false
  }

  function resume(): void {
    if (!current.value) return
    const el = ensureAudio()
    void el.play().catch((err: unknown) => {
      error.value = cleanIpcError(err)
    })
  }

  function toggle(): void {
    if (playing.value) pause()
    else resume()
  }

  function seek(seconds: number): void {
    const el = ensureAudio()
    if (!Number.isFinite(seconds)) return
    el.currentTime = Math.max(0, seconds)
    currentTime.value = el.currentTime
  }

  function seekByPercent(percent: number): void {
    if (duration.value <= 0) return
    seek((percent / 100) * duration.value)
  }

  function setVolume(value: number): void {
    const clamped = Math.max(0, Math.min(1, value))
    volume.value = clamped
    if (audio) audio.volume = clamped
  }

  /* ------------------------------ 上下一首 ------------------------------ */

  function nextIndex(): number {
    const total = playlist.value.length
    if (total === 0) return -1

    switch (mode.value) {
      case 'single':
        return currentIndex.value
      case 'shuffle': {
        if (total === 1) return 0
        let candidate = currentIndex.value
        while (candidate === currentIndex.value) {
          candidate = Math.floor(Math.random() * total)
        }
        return candidate
      }
      case 'loop':
        return (currentIndex.value + 1) % total
      case 'order':
      default:
        return currentIndex.value + 1
    }
  }

  async function playNext(): Promise<void> {
    const idx = nextIndex()
    if (idx < 0 || idx >= playlist.value.length) return
    currentIndex.value = idx
    await play(playlist.value[idx])
  }

  async function playPrev(): Promise<void> {
    const total = playlist.value.length
    if (total === 0) return
    const idx = (currentIndex.value - 1 + total) % total
    currentIndex.value = idx
    await play(playlist.value[idx])
  }

  async function handleEnded(): Promise<void> {
    if (mode.value === 'single') {
      seek(0)
      resume()
      return
    }
    const idx = nextIndex()
    // 顺序播放到队尾就停下
    if (mode.value === 'order' && idx >= playlist.value.length) {
      playing.value = false
      return
    }
    await playNext()
  }

  /** 切换播放模式 */
  function cycleMode(): void {
    const order: PlayMode[] = ['order', 'loop', 'single', 'shuffle']
    const idx = order.indexOf(mode.value)
    mode.value = order[(idx + 1) % order.length]
  }

  /** 切换音质，当前歌曲立即按新音质重取地址 */
  async function setQuality(next: Quality): Promise<void> {
    quality.value = next
    if (current.value) await play(current.value)
  }

  /** 队列操作 */
  function addToQueue(song: Song): void {
    if (!playlist.value.some((s) => s.id === song.id)) {
      playlist.value.push(song)
    }
  }

  function removeFromQueue(id: string): void {
    const idx = playlist.value.findIndex((s) => s.id === id)
    if (idx < 0) return
    playlist.value.splice(idx, 1)
    if (idx === currentIndex.value) {
      // 删掉的正是在播的歌，顺延到下一首
      if (playlist.value.length > 0) {
        currentIndex.value = Math.min(idx, playlist.value.length - 1)
      } else {
        currentIndex.value = -1
        current.value = null
        audio?.pause()
      }
    } else if (idx < currentIndex.value) {
      currentIndex.value -= 1
    }
  }

  function clearQueue(): void {
    playlist.value = []
    currentIndex.value = -1
    current.value = null
    audio?.pause()
    if (audio) audio.src = ''
  }

  const MODE_LABEL: Record<PlayMode, string> = {
    order: '顺序播放',
    loop: '列表循环',
    single: '单曲循环',
    shuffle: '随机播放'
  }

  const modeLabel = computed(() => MODE_LABEL[mode.value])

  return {
    // 状态
    playlist,
    currentIndex,
    current,
    playing,
    loading,
    error,
    currentTime,
    duration,
    volume,
    quality,
    mode,
    modeLabel,
    urlInfo,
    attempts,
    lyricRaw,
    lyricLines,
    // 派生
    progress,
    currentLyricIndex,
    hasLyric,
    // 动作
    play,
    pause,
    resume,
    toggle,
    seek,
    seekByPercent,
    setVolume,
    playNext,
    playPrev,
    cycleMode,
    setQuality,
    addToQueue,
    removeFromQueue,
    clearQueue,
    loadLyric
  }
})
