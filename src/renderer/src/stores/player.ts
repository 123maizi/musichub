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
import { getLyric as fetchLyric, getPlayUrl, reportBadSource } from '../utils/ipc'
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

  /* ------------------------------ 试听片段检测 ------------------------------ */

  /** 已标记过质量问题的音源 id，避免对同一首歌反复上报同一个源 */
  const markedSourceId = ref('')
  /** 连续换源次数，防止在「全是片段源」的情况下无限重试 */
  const fragmentAttempts = ref(0)

  /**
   * 用户是否手动暂停过。
   *
   * 这是一道闸门：「暂停一会儿自己又响起来」这类故障，八成是某个异步流程
   * （换源重试、自动切歌、错误恢复）走到了 play()。
   * 只要用户明确按过暂停，后续任何后台逻辑都不许自作主张恢复播放。
   */
  const userPaused = ref(false)

  /**
   * 校验音频实际长度。
   *
   * 部分音源给的是试听片段：实测有一条返回 47.9 秒的音频，而歌曲本身标注 250 秒。
   * 更麻烦的是这类源响应往往还很快，不主动识别的话调度器会一直优先选它，
   * 用户听到的永远是半截歌。
   *
   * 这里在拿到元数据的第一时间就判断，太短就标记该音源并自动换源重播。
   */
  async function verifyDuration(): Promise<void> {
    const song = current.value
    const info = urlInfo.value
    const el = audio
    if (!song || !info || !el) return

    const actual = el.duration
    const expected = song.duration
    if (!Number.isFinite(actual) || actual <= 0) return
    // 歌曲本身很短、或平台没给时长时不做判断，避免误杀
    if (!expected || expected < 45) return

    // 差距在 25% 以内视为正常：不同音源的版本确实可能略有长短
    if (actual >= expected * 0.75) {
      fragmentAttempts.value = 0
      return
    }

    // 用户主动暂停过就别自动换源重播，免得「暂停后自己又响起来」
    if (userPaused.value) return

    // 同一个源只上报一次，否则会反复触发
    if (markedSourceId.value === info.sourceId) return
    markedSourceId.value = info.sourceId

    try {
      await reportBadSource(info.sourceId, song, `只提供 ${Math.round(actual)} 秒的试听片段`)
    } catch {
      /* 上报失败不影响换源 */
    }

    fragmentAttempts.value += 1
    if (fragmentAttempts.value > 3) {
      error.value = `已连续换过 ${fragmentAttempts.value} 个音源都只能试听，这首歌暂时听不了完整版`
      playing.value = false
      return
    }

    error.value = `上一个音源只给了 ${Math.round(actual)} 秒，已自动换源重试`
    await play(song)
  }

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
    el.addEventListener('loadedmetadata', () => {
      syncDuration()
      // 拿到元数据就校验时长：太短说明是试听片段，立刻换源，别等用户听半截
      void verifyDuration()
    })
    el.addEventListener('durationchange', syncDuration)
    el.addEventListener('progress', syncDuration)
    el.addEventListener('play', () => {
      playing.value = true
    })
    el.addEventListener('pause', () => {
      playing.value = false
    })
    el.addEventListener('ended', () => {
      /**
       * 防御：正常播完应该停在接近结尾的位置。
       *
       * 明显提前触发，说明音频流被异常中断（典型原因是音源只给了试听片段，
       * 或者流被中途掐断）。这时自动切下一首，在用户看来就是
       * 「莫名其妙自己跳歌」—— 与其莫名其妙地跳，不如停下来把原因讲清楚。
       */
      const total = el.duration
      const played = el.currentTime
      if (Number.isFinite(total) && total > 2 && played < total - 2) {
        error.value = '音频流提前中断，该音源可能只提供试听片段'
        playing.value = false
        void verifyDuration()
        return
      }
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
    // 新一轮播放由用户发起或由明确的切歌动作触发，解除暂停闸门
    userPaused.value = false
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
    // 记住「这是用户主动暂停的」，后续任何后台逻辑都不许偷偷恢复播放
    userPaused.value = true
    audio?.pause()
    playing.value = false
  }

  function resume(): void {
    if (!current.value) return
    userPaused.value = false
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
