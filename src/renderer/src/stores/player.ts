/**
 * 播放器状态中枢
 *
 * 播放地址一律通过 IPC 从主进程取（音源择优在那边完成），
 * 渲染层只负责驱动 <audio> 与维护播放列表。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Lyric, MusicUrlResult, Quality, Song } from '@shared/types/music'
import { cleanIpcError, findLyricIndex, parseLrcWithTranslation, type LyricLine } from '../utils/format'
import {
  deleteSavedTranslation,
  getLyric as fetchLyric,
  getPlayUrl,
  getSavedTranslation,
  reportBadSource,
  saveTranslation,
  translateLyric
} from '../utils/ipc'
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

  /** 歌词翻译状态：进行中 / 已翻译 / 失败原因 */
  const translating = ref(false)
  const translated = ref(false)
  const translateError = ref('')
  /** 已翻译过的歌曲 id，避免切歌回来重复消耗翻译配额 */
  const translatedSongId = ref('')
  /** 是否显示译文（用户可随时关掉） */
  const showTranslation = ref(true)
  /** 当前译文是不是用户手工改过的（改过的不会被自动翻译覆盖） */
  const savedEdited = ref(false)
  /** 译文来源：ai / public / official / manual */
  const savedProvider = ref('')
  /** AI 的话记下模型名，界面显示「本歌词由 xxx 翻译」 */
  const savedProviderName = ref('')

  /* ------------------------------ 译文编辑 ------------------------------ */

  /** 编辑器是否打开 */
  const editing = ref(false)
  /** 编辑中的行：时间戳 + 原文 + 译文输入 */
  const editLines = ref<{ time: number; text: string; trans: string }[]>([])
  const savingEdit = ref(false)

  let audio: HTMLAudioElement | null = null

  /**
   * 上一次「程序化跳转」的时间戳。
   * 拖动进度条后紧接着收到的 ended 不可信（详见 seek 与 ended 处的说明）。
   */
  let lastSeekAt = 0

  /**
   * 拖动进度条后多久内不认 ended。
   * 1.2 秒足够覆盖「拖到结尾 → 立刻 ended」这个瞬间，
   * 又不会长到把真正的播放结束挡在外面。
   */
  const SEEK_ENDED_GUARD = 1200

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

  /** 当前歌词是否含译文（用于决定界面上要不要留译文行） */
  const hasTranslation = computed(() =>
    showTranslation.value && lyricLines.value.some((line) => !!line.trans)
  )

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
    // 本地文件没有音源可换，时长对不上多半是标签写得不准，不该去换源
    if (song.platform === 'local') return
    // 歌曲本身很短、或平台没给时长时不做判断，避免误杀
    if (!expected || expected < 45) return

    /**
     * 真正的试听片段通常也有几十秒（实测那条是 47.9 秒）。
     * 秒级的时长多半是流还没就绪时上报的临时值 ——
     * 这种时候换源，只会把一个正常音源误判成坏的，还会让歌突然跳走。
     */
    if (actual < 15) return

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
      const total = el.duration
      const played = el.currentTime

      /**
       * 用户明确按过暂停，就绝不允许任何「自动」行为。
       *
       * 这是「暂停后切后台自己又响起来」的根因：单曲循环模式下
       * handleEnded 会 seek(0) + resume()，而 resume() 会把 userPaused
       * 清掉并真的开始播放。只要 ended 在暂停期间冒出来（流被掐断、
       * 后台恢复时的陈旧事件都可能触发），用户就会看到「明明暂停了却自己开播」。
       */
      if (userPaused.value) {
        playing.value = false
        return
      }

      /**
       * 刚拖过进度条就判「播完了」是不可信的。
       * 拖动落点若靠近结尾，浏览器会立刻发 ended —— 此时用户显然不是
       * 想切歌，只是把光标放到了尾巴上。这种情况只停下，不自动跳。
       */
      if (Date.now() - lastSeekAt < SEEK_ENDED_GUARD) {
        playing.value = false
        return
      }

      /**
       * 判断这次 ended 是不是「真的播完了」。
       *
       * 正常播完：时长合理（≥15 秒）且位置停在接近结尾处。
       *
       * 落到 else 的常见情况有两种，都绝不能自动切歌：
       *   1. 音频流被掐断 —— 位置离结尾还差得远
       *   2. 时长本身异常 —— 比如流还没就绪就报了个 1 秒
       * 上一版就是漏了第 2 种：1 秒的流播完立刻 ended，
       * 条件判定不成立于是走到切歌分支，用户看到的就是「播一秒自己跳了」。
       */
      const looksComplete = Number.isFinite(total) && total >= 15 && played >= total - 3

      if (!looksComplete) {
        playing.value = false
        error.value = '音频流异常中断，已停止自动切歌'
        // 只有「时长够长、却远没播完」才能判定为试听片段源
        if (Number.isFinite(total) && total >= 15 && played < total - 3) {
          void verifyDuration()
        }
        return
      }

      /**
       * 最后一道闸：这首歌**本该更长**，却在这里就播完了 —— 说明拿到的是残缺流。
       *
       * 从播放器的角度看这次确实播到了结尾，所以上面的判断会放行；
       * 但歌曲元数据说它还有几分钟。这种「听着听着突然切歌」正是这么来的：
       * 音源给了一段短流，播完就跳到下一首，用户完全莫名其妙。
       * 这里宁可停下来报错并换源，也不替用户做切歌的决定。
       */
      const expected = current.value?.duration ?? 0
      if (expected > 60 && total < expected * 0.75) {
        playing.value = false
        error.value = `这版音源只有 ${Math.round(total)} 秒（原曲约 ${Math.round(expected)} 秒），已停在原处，没有自动切歌`
        void verifyDuration()
        return
      }

      void handleEnded()
    })
    el.addEventListener('error', () => {
      // 本地文件的失败原因和网络音源完全不同，提示得分开写，
      // 否则用户会看到「音源地址失效」去折腾音源，而其实是文件被删了
      error.value =
        current.value?.platform === 'local'
          ? '播放失败：本地文件读不出来，可能已被删除或移动到别处'
          : '播放失败：该音源地址已失效，换首歌或切换音源试试'
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
    // 翻译状态跟着歌曲走，切歌必须清干净，否则会把上一首的译文留在界面上
    translated.value = false
    translateError.value = ''
    translatedSongId.value = ''
    savedEdited.value = false
    savedProvider.value = ''
    savedProviderName.value = ''
    // 切歌时把编辑器关掉，免得把上一首的编辑内容留在界面上
    editing.value = false
    editLines.value = []
    currentTime.value = 0
    // 换歌了，上一首的「刚拖过进度条」状态不能带过来
    lastSeekAt = 0
    /**
     * 换歌必须重置「已上报坏源」与「连续换源次数」。
     *
     * markedSourceId 以前是不重置的：第一首歌把某个音源标记为坏之后，
     * 后面每首歌都会因为这个「已经标过」的判断而跳过试听片段检测 ——
     * 于是残缺流一路播到底，播完就自动切歌。这正是「听着听着突然换歌」
     * 最可能的来源。
     */
    markedSourceId.value = ''
    fragmentAttempts.value = 0
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
      // 平台自带翻译（QQ、网易云常有）直接合并展示，不用再翻
      lyricLines.value = parseLrcWithTranslation(main, lyric.tlyric)
      translated.value = lyricLines.value.some((line) => !!line.trans)
      translateError.value = ''
      translatedSongId.value = translated.value ? song.id : ''
      savedEdited.value = false
      savedProvider.value = lyric.tlyric?.trim() ? 'official' : ''
      savedProviderName.value = ''

      /**
       * 平台没给翻译时，看看之前有没有翻过这首。
       *
       * 这就是「翻完切歌回来就没了」的修法：译文存在主进程里（按歌曲 id），
       * 这里取回来直接套用 —— 不管隔了多少首歌、哪怕重启过应用，
       * 回来还是那份译文。手工改过的更是要原样拿回来。
       */
      if (!translated.value) {
        const saved = await getSavedTranslation(song.id)
        if (saved && current.value?.id === song.id && saved.tlyric.trim()) {
          lyricLines.value = parseLrcWithTranslation(main, saved.tlyric)
          translated.value = lyricLines.value.some((line) => !!line.trans)
          translatedSongId.value = song.id
          savedEdited.value = saved.edited
          savedProvider.value = saved.provider
          savedProviderName.value = saved.providerName ?? ''
        }
      }
    } catch {
      lyricLines.value = []
      translated.value = false
    }
  }

  /**
   * 翻译当前歌词。
   *
   * 只在「确实产生了译文」时才算成功 —— 上一版栽在这里：翻译接口报错后
   * 静默保留了原文，界面却显示翻译成功，用户看到的是没变的原文。
   */
  async function translateCurrentLyric(): Promise<boolean> {
    const song = current.value
    const lyric = lyricRaw.value
    if (!song || !lyric || translating.value) return false

    // 已经翻过这首就不用重复请求（翻译接口有配额）
    if (translated.value && translatedSongId.value === song.id) {
      showTranslation.value = !showTranslation.value
      return true
    }

    translating.value = true
    translateError.value = ''

    try {
      const result = await translateLyric(lyric, 'zh-CN', song)
      // 期间换歌了就丢弃结果，别把上一首的译文贴到这一首上
      if (current.value?.id !== song.id) return false

      if (!result.translated || !result.lyric) {
        translateError.value = result.error || '翻译失败'
        return false
      }

      lyricRaw.value = result.lyric
      const main = result.lyric.lyric || result.lyric.lxlyric || ''
      lyricLines.value = parseLrcWithTranslation(main, result.lyric.tlyric)

      /**
       * 最后一道保险：一句译文都没贴上，就不算翻译成功。
       *
       * 主进程已经做了两层校验（行数一致、抄写比例），这里再兜一次 ——
       * 因为「提示翻译成功、界面上一句译文都没有」是最让人恼火的失败形态：
       * 用户不知道是自己点错了、网络坏了，还是软件坏了。
       * 贴不回去就如实说清楚，绝不装作翻好了。
       */
      const applied = lyricLines.value.filter((line) => !!line.trans).length
      if (applied === 0) {
        translated.value = false
        translateError.value =
          '译文已经拿到，但没能对应到歌词行（这首歌的歌词可能换过版本）。可以点「修改译文 / 添加译文」手工填'
        return false
      }

      translated.value = true
      translatedSongId.value = song.id
      showTranslation.value = true
      // 部分行没翻出来时也如实说明，不假装全翻好了
      translateError.value = result.error ?? ''
      // 结果已由主进程按歌曲 id 存好，这里同步一下状态即可
      savedEdited.value = false
      savedProvider.value = result.provider ?? 'ai'
      // 记下模型名：界面要显示「本歌词由 deepseek-chat 翻译」
      savedProviderName.value = result.providerName ?? ''
      return true
    } catch (err) {
      translateError.value = cleanIpcError(err)
      return false
    } finally {
      translating.value = false
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

    /**
     * 必须夹到「真正能播到的位置」。
     *
     * 这里踩过两个坑，合起来就是「拖进度条有概率从头播放或直接切歌」：
     *
     *  1. 元数据时长常常长于流的真实时长（音源给试听片段时尤其明显，
     *     标注 290 秒、流里只有 48 秒）。按比例换算出的目标位置早就越过结尾，
     *     浏览器会把它夹到结尾并立刻判定播放结束 → 自动切歌。
     *  2. 拖到 100% 本身也落在结尾上，同样立刻触发结束。
     *
     * 所以这里取 seekable 的终点再往回让 0.3 秒 —— 落点永远在结尾之前，
     * 不会因为「恰好拖到边界」被判成播完。
     */
    const end = seekableEnd(el)
    const target = Math.max(0, Math.min(seconds, end))
    lastSeekAt = Date.now()
    try {
      el.currentTime = target
    } catch {
      /* 元数据还没就绪时赋值可能抛错，忽略即可 */
    }
    currentTime.value = el.currentTime
  }

  /** 可跳转区间的终点（秒）；拿不到就退回 duration，再拿不到就给个足够大的值 */
  function seekableEnd(el: HTMLAudioElement): number {
    const EPSILON = 0.3
    try {
      if (el.seekable && el.seekable.length > 0) {
        const end = el.seekable.end(el.seekable.length - 1)
        if (Number.isFinite(end) && end > 0) return Math.max(0, end - EPSILON)
      }
    } catch {
      /* 某些状态下访问 seekable 会抛错 */
    }
    if (Number.isFinite(el.duration) && el.duration > 0) {
      return Math.max(0, el.duration - EPSILON)
    }
    return Number.MAX_SAFE_INTEGER
  }

  function seekByPercent(percent: number): void {
    const el = ensureAudio()

    /**
     * 按「流的真实时长」换算，而不是元数据时长。
     * 进度条刻度用的是 duration（可能来自元数据），两者不一致时
     * 以真实时长为准才不会越过结尾。
     */
    const real = el.duration
    const total = Number.isFinite(real) && real > 0 ? real : duration.value
    if (!(total > 0)) return

    const clamped = Math.max(0, Math.min(100, percent))
    seek((clamped / 100) * total)
  }

  function setVolume(value: number): void {
    const clamped = Math.max(0, Math.min(1, value))
    volume.value = clamped
    if (audio) audio.volume = clamped
  }

  /* ------------------------------ 译文的编辑与保存 ------------------------------ */

  /**
   * 打开译文编辑器。
   *
   * 支持两种用法：
   *   · 已经有译文 → 改它（「修改歌词翻译」）
   *   · 还没有译文 → 从空白开始填（「添加歌词翻译」）
   * 两者其实是同一个界面，只是初值不同，没必要做两套。
   */
  function openEditor(): void {
    const song = current.value
    if (!song) return
    editLines.value = lyricLines.value
      .filter((line) => !!line.text)
      .map((line) => ({ time: line.time, text: line.text, trans: line.trans ?? '' }))
    editing.value = true
  }

  function closeEditor(): void {
    editing.value = false
    editLines.value = []
  }

  /** 秒 → LRC 时间戳 [mm:ss.xx] */
  function toLrcTime(seconds: number): string {
    const safe = Math.max(0, seconds)
    const min = Math.floor(safe / 60)
    const sec = Math.floor(safe % 60)
    const centi = Math.round((safe - Math.floor(safe)) * 100)
    return `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(centi).padStart(2, '0')}]`
  }

  /**
   * 保存编辑好的译文。
   *
   * 必须带时间戳 —— 译文行是**按时间戳**贴回原文的（见 format.ts 的
   * mergeTranslation），只存纯文字的话贴不回去，保存了也看不见效果。
   * 时间戳直接取原文行的，所以对得上是精确匹配。
   *
   * 只写填了译文的行：空着表示「这行不翻」，用户既能逐行补，也能只改几句。
   */
  async function saveEditor(): Promise<boolean> {
    const song = current.value
    if (!song) return false

    savingEdit.value = true
    try {
      const filled = editLines.value.filter((line) => line.trans.trim())
      const tlyric = filled.map((line) => `${toLrcTime(line.time)}${line.trans.trim()}`).join('\n')

      const main = lyricRaw.value?.lyric || lyricRaw.value?.lxlyric || ''

      if (!tlyric.trim()) {
        // 全空 = 不要译文了
        await deleteSavedTranslation(song.id)
        lyricLines.value = parseLrcWithTranslation(main)
        translated.value = false
        savedEdited.value = false
        savedProvider.value = ''
        savedProviderName.value = ''
        closeEditor()
        return true
      }

      await saveTranslation({
        songId: song.id,
        tlyric,
        provider: 'manual',
        edited: true,
        updatedAt: Date.now()
      })

      lyricLines.value = parseLrcWithTranslation(main, tlyric)
      translated.value = lyricLines.value.some((line) => !!line.trans)
      translatedSongId.value = song.id
      savedEdited.value = true
      savedProvider.value = 'manual'
      showTranslation.value = true
      closeEditor()
      return true
    } catch (err) {
      translateError.value = cleanIpcError(err)
      return false
    } finally {
      savingEdit.value = false
    }
  }

  /** 删掉译文，等于「重新翻一遍」 */
  async function clearTranslation(): Promise<void> {
    const song = current.value
    if (!song) return
    await deleteSavedTranslation(song.id)
    const main = lyricRaw.value?.lyric || lyricRaw.value?.lxlyric || ''
    lyricLines.value = parseLrcWithTranslation(main, lyricRaw.value?.tlyric)
    translated.value = lyricLines.value.some((line) => !!line.trans)
    translatedSongId.value = translated.value ? song.id : ''
    savedEdited.value = false
    savedProvider.value = translated.value ? 'official' : ''
    savedProviderName.value = ''
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
    // 用户按过暂停就什么都不做 —— resume() 会清掉暂停闸门，
    // 是这个「暂停后自己又播起来」的最后一道口子
    if (userPaused.value) return

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
    translating,
    translated,
    translateError,
    showTranslation,
    savedEdited,
    savedProvider,
    savedProviderName,
    editing,
    editLines,
    savingEdit,
    // 派生
    progress,
    currentLyricIndex,
    hasLyric,
    hasTranslation,
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
    loadLyric,
    translateCurrentLyric,
    openEditor,
    closeEditor,
    saveEditor,
    clearTranslation
  }
})
