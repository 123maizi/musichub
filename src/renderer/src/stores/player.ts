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
   * 播放「代次」。每次 play()（含切歌）都 +1。
   *
   * 取流是异步的：先点 A 再点 B 时，A 的结果完全可能晚于 B 返回。
   * 旧代码不区分代次，晚到的 A 会把流盖到正在播的 B 上 —— 听的就是「点 B 放 A」。
   * 所有 await 之后都必须确认自己仍是当前这一代。
   */
  let playToken = 0

  /**
   * 是否正在换源重取。
   * 换流期间要忽略两件事：新流的 loadedmetadata 二次校验（避免自己和自己的换源打架）、
   * 以及「给元素换 src」顺带触发的那次 pause（那不是用户暂停）。
   */
  let switching = false

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
   * 判定「明显只有一小段」的比例上限。
   *
   * 0.6 是实测折中：平台元数据本身经常不准（实测同一首歌，平台标 269 秒、
   * 音源给的是 200 秒的**完整版**，比值 0.74）。旧值 0.75 会把这种完整版
   * 误判成试听片段，接着自动换源重播 —— 用户看到的就是「进度条偶尔回退」。
   * 只有短到连六成都不到、且缺口超过一分钟，才值得动播放。
   */
  const FRAGMENT_RATIO = 0.6
  /** 判定「明显只有一小段」的绝对缺口（秒）：单纯短十几秒不打扰播放 */
  const FRAGMENT_GAP = 60
  /** 连续换源上限，防止「整页音源都只有片段」时无限重试 */
  const MAX_FRAGMENT_ATTEMPTS = 3

  /**
   * 进度计算用的时长。
   *
   * 优先用音频元素上报的值；拿不到就退回歌曲元数据里的时长。
   * 之前「进度条不走」的根因就在这里：音源不上报时长时，
   * durationchange 会把时长覆盖成 0，进度于是永远停在 0%。
   *
   * 但流报出来的时长如果**明显短于**平台标注（疑似试听片段），就不能拿它当基准：
   * 换到完整音源的瞬间，同一个播放位置会从「48 秒里的 60%」变成
   * 「250 秒里的 12%」，看起来又是一次回退。这种情况以歌曲时间轴为准，
   * 等真的换到完整流，再切回流自己的时长。
   */
  const duration = computed(() => {
    const media = mediaDuration.value
    const expected = current.value?.duration ?? 0
    if (Number.isFinite(media) && media > 0) {
      if (expected > 0 && media < expected * FRAGMENT_RATIO) return expected
      return media
    }
    return expected
  })

  /**
   * 界面进度（0-100）。
   *
   * 刻意做成「只增不减」的累计值，而不是每次都重算的 computed：
   * 同一首歌里时长会从元数据切换成流的真实时长，重算就会突然跳一下。
   * 只有用户主动 seek、换源落位、换歌这三种情况才允许回退（见 reportTime）。
   */
  const progress = ref(0)

  /** 按当前时长把进度往上顶一格；force=true 表示允许回退 */
  function bumpProgress(force = false): void {
    const total = duration.value
    if (!(total > 0)) {
      if (force) progress.value = 0
      return
    }
    const raw = Math.max(0, Math.min(100, (currentTime.value / total) * 100))
    if (force || raw > progress.value) progress.value = raw
  }

  /**
   * 「正在换歌、新流还没接上」的窗口期。
   *
   * 为什么必须有这个标记：换歌时我们先清空进度，然后 **await 取流**（网络 + 选源，
   * 可能持续几百毫秒到几秒），这之后才 `el.src = 新地址`。在这段窗口里**旧音频还在播**，
   * `timeupdate` 会持续按上一首的秒数上报 —— 而 reportTime 的单调守卫只挡「回退」，
   * 刚清零的 currentTime 让任何值都算「前进」，于是进度被顶回上一首的位置。
   * 用户看到的就是「切歌了进度条还停在上一首」。
   *
   * 所以：换歌期间停掉旧流 + 一律不采信时间上报，直到新流接上。
   */
  let awaitingStream = false

  /** 允许的进度回退容差（秒）：抹掉流重载、时长微调造成的亚秒级抖动 */
  const TIME_BACK_TOLERANCE = 0.75

  /**
   * 上报播放位置。
   *
   * force=true 表示「这是用户主动跳转 / 换源落位」，允许位置倒退；
   * 否则同一首歌内位置只增不减 —— 换流时音频元素会先把 currentTime 报成 0，
   * 那道回退正是用户看到的「进度条突然归零」。
   */
  function reportTime(value: number, force = false): void {
    if (!Number.isFinite(value) || value < 0) return
    if (!force && value + TIME_BACK_TOLERANCE < currentTime.value) return
    currentTime.value = value
    bumpProgress(force)
  }

  const currentLyricIndex = computed(() => findLyricIndex(lyricLines.value, currentTime.value))

  const hasLyric = computed(() => lyricLines.value.length > 0)

  /** 当前歌词是否含译文（用于决定界面上要不要留译文行） */
  const hasTranslation = computed(() =>
    showTranslation.value && lyricLines.value.some((line) => !!line.trans)
  )

  /* ------------------------------ 试听片段检测 ------------------------------ */

  /**
   * 这首歌里已经上报过问题的音源 id。
   * 用集合而不是单个字符串：一次播放可能连续换掉好几个源。
   */
  const markedSources = new Set<string>()
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
   * 这个时长是不是「明显只有一小段」？
   *
   * 两个条件必须同时满足，比旧版只看比例严格得多：
   *   1. 短于平台标注的 60%
   *   2. 绝对缺口超过 60 秒
   * 缺一条就只是「版本长短有差异」，不该动用户的播放。
   * 另外排除两类**看起来像片段、其实不是**的值：
   *   · 平台没给时长（expected 为 0 / 太短）——没有基准可比
   *   · 15 秒以内的上报值 —— 流还没就绪时的临时值，拿它换源只会误杀好音源
   */
  function isFragmentDuration(actual: number, expected: number): boolean {
    if (!Number.isFinite(actual) || actual <= 0) return false
    if (!expected || expected < 45) return false
    if (actual < 15) return false
    return actual < expected * FRAGMENT_RATIO && expected - actual > FRAGMENT_GAP
  }

  /**
   * 校验音频实际长度。
   *
   * 部分音源确实给的是试听片段：实测有一条返回 47.9 秒的音频，而歌曲本身标注 250 秒。
   * 更麻烦的是这类源响应往往还很快，不主动识别的话调度器会一直优先选它，
   * 用户听到的永远是半截歌。
   *
   * 但「换源」不再等于「重播」：交给 switchSource 保住播放位置。
   * 旧版这里直接 `await play(song)`，等于把整首歌从头放 —— 进度条归零、
   * 歌词重拉、播放记录再写一条，这就是「偶尔回退」的来源。
   */
  async function verifyDuration(): Promise<void> {
    const song = current.value
    const info = urlInfo.value
    const el = audio
    if (!song || !info || !el) return
    // 本地文件没有音源可换，时长对不上多半是标签写得不准，不该去换源
    if (song.platform === 'local') return
    // 正在换源：新流的校验由换源流程自己收尾，别在这里打架
    if (switching) return

    const actual = el.duration

    // 时长正常（含「只是版本长短不同」）→ 什么都不做，继续播
    if (!isFragmentDuration(actual, song.duration)) {
      if (Number.isFinite(actual) && actual > 0) fragmentAttempts.value = 0
      return
    }

    // 用户主动暂停过就别自动换源，免得「暂停后自己又响起来」
    if (userPaused.value) return
    // 同一个源在这首歌里只上报一次，否则会反复触发
    if (markedSources.has(info.sourceId)) return

    const at = Number.isFinite(el.currentTime) && el.currentTime > 0 ? el.currentTime : 0
    const ok = await switchSource(song, at, {
      reason: `只提供 ${Math.round(actual)} 秒`,
      // 判定为片段才上报坏源：上报同时会清掉这首歌的取流缓存，
      // 否则「换源」会原样拿回同一条片段地址。判据已经收得很紧，
      // 好音源不会因为「和平台标称时长对不上」被拉黑。
      report: true
    })
    // 新流可能还是片段：再验一次（换源次数有上限，不会无限循环）
    if (ok) void verifyDuration()
  }

  /**
   * 换源重取：只换流，不重播。
   *
   * 位置原样保留（越界时夹到新流末尾附近），歌词、播放记录、翻译状态全都不动。
   * 这是「进度条绝不因为换源归零」的唯一实现点。
   */
  async function switchSource(
    song: Song,
    at: number,
    opts: { reason: string; report?: boolean }
  ): Promise<boolean> {
    if (switching) return false
    const token = playToken
    const el = ensureAudio()
    const info = urlInfo.value

    switching = true
    loading.value = true
    /** 是否已经动过音频元素：决定失败时要不要把 playing 改掉 */
    let touched = false
    try {
      if (opts.report && info?.sourceId && !markedSources.has(info.sourceId)) {
        markedSources.add(info.sourceId)
        try {
          await reportBadSource(info.sourceId, song, opts.reason)
        } catch {
          /* 上报失败不影响换源 */
        }
      }
      if (token !== playToken || current.value?.id !== song.id) return false

      fragmentAttempts.value += 1
      if (fragmentAttempts.value > MAX_FRAGMENT_ATTEMPTS) {
        error.value = `已连续换过 ${MAX_FRAGMENT_ATTEMPTS} 个音源都只能播放一小段，这首歌暂时听不了完整版`
        playing.value = false
        return false
      }

      const result = await getPlayUrl({ song, quality: quality.value })
      if (token !== playToken || current.value?.id !== song.id) return false

      urlInfo.value = result
      attempts.value = result.attempts ?? []

      /**
       * 落点取「调用方指定位置」与「此刻音频真实位置」中较大的那个。
       *
       * 取流是异步的：判定要换源时歌还在继续播，等新地址回来可能已经过去十几秒。
       * 若只按判定那一刻的位置落位，这十几秒会被倒回去 —— 那正是要消灭的「进度条回退」。
       * 以此刻的真实位置为准，换源前后进度严丝合缝；新流更短时由 applyPosition 夹到末尾附近。
       */
      const resumeAt = Math.max(at, Number.isFinite(el.currentTime) ? el.currentTime : at)

      el.src = result.url
      touched = true
      await waitForMetadata(el)
      if (token !== playToken || current.value?.id !== song.id) return false

      // 关键一步：回到换源前的位置（超过新流时长就落在新流末尾附近）
      applyPosition(el, resumeAt)

      // 用户按过暂停就停在原地，只把流换好，绝不自己开播
      if (!userPaused.value) {
        await el.play()
        if (token !== playToken) return false
        playing.value = true
      }
      return true
    } catch (err) {
      if (token === playToken) {
        error.value = cleanIpcError(err)
        if (touched) playing.value = false
      }
      return false
    } finally {
      switching = false
      if (token === playToken) loading.value = false
    }
  }

  /** 等新流报出元数据（时长/seekable 就绪）；超时就按现有信息落位，不把流程挂死 */
  function waitForMetadata(el: HTMLAudioElement, timeout = 4000): Promise<void> {
    if (el.readyState >= 1) return Promise.resolve()
    return new Promise((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        el.removeEventListener('loadedmetadata', finish)
        el.removeEventListener('error', finish)
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(finish, timeout)
      el.addEventListener('loadedmetadata', finish)
      el.addEventListener('error', finish)
    })
  }

  /** 把播放位置落到 at 秒；越界时夹到可跳转区间的末尾附近 */
  function applyPosition(el: HTMLAudioElement, at: number): void {
    const end = seekableEnd(el)
    const target = end === null ? Math.max(0, at) : Math.max(0, Math.min(at, end))
    // 拖过进度条 / 换源落位后紧接着的 ended 不可信（见 ended 处说明）
    lastSeekAt = Date.now()
    try {
      el.currentTime = target
    } catch {
      /* 元数据还没就绪时赋值可能抛错，忽略即可 */
    }
    const applied = Number.isFinite(el.currentTime) ? el.currentTime : 0
    /**
     * 只有「真的落到位了」才允许改写进度。
     * 若目标位置明显大于 0、元素却仍报 0，说明这次跳转没生效
     * （元数据没就绪 / 元素状态不允许），此时保持原进度不动 ——
     * 强行按元素当前值刷新，就是又一次「进度条被打回起点」。
     */
    if (applied > 0.05 || target <= 0.05) reportTime(applied, true)
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
      if (Number.isFinite(value) && value > 0) {
        mediaDuration.value = value
        bumpProgress()
      }
    }

    el.addEventListener('timeupdate', () => {
      /**
       * 换歌取流期间，元素上报的还是**上一首**的秒数 —— 一律不采信。
       * 这里没有用 playToken 比较，是因为 Audio 元素是复用的单例、
       * 监听器只注册一次，捕获到的 token 早已过期，比了也没意义；
       * 用一个显式的窗口期标记反而更准（它精确覆盖「已清零、新流未接上」这段）。
       */
      if (awaitingStream) return
      reportTime(el.currentTime)
      // 顺带兜底：有些音源要播一会儿才报出真实时长
      syncDuration()
    })
    el.addEventListener('loadedmetadata', () => {
      // 新流的元数据到了，窗口期结束，此后上报的时间属于新歌
      awaitingStream = false
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
      // 换源时给元素换 src 会顺带触发一次 pause，那不是用户按的暂停
      if (switching) return
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
        // 只有「时长够长、却远没播完」才值得再验一次是不是片段源
        if (Number.isFinite(total) && total >= 15 && played < total - 3) {
          void verifyDuration()
        }
        return
      }

      /**
       * 最后一道闸：这次确实播到了流的结尾，但相对歌曲标注明显只有一小段。
       *
       * 旧版在这里是「停下 + 报错 + 换源重播」：用户听着听着歌停了，
       * 再按播放又是从头开始，进度条直接归零。
       * 现在改成换源续播 —— 位置就是刚播到的秒数，进度条一步都不退。
       */
      const expected = current.value?.duration ?? 0
      if (current.value && isFragmentDuration(total, expected)) {
        playing.value = false
        void switchSource(current.value, played, {
          reason: `只提供 ${Math.round(total)} 秒`,
          report: true
        })
        return
      }

      void handleEnded()
    })
    el.addEventListener('error', () => {
      /**
       * 清空队列 / 卸载资源时也会收到 error（把 src 置空就是这样）。
       * 那时并没有在播的歌，不该弹「音源地址已失效」误导用户。
       */
      if (!current.value || (!el.src && !el.currentSrc)) {
        playing.value = false
        loading.value = false
        return
      }
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

    /**
     * 领一个属于自己的代次号。
     * 这之后每一步 await 回来，都要确认自己还是当前这一代 ——
     * 否则「先点 A 再点 B，A 的取流结果最后返回」会把 B 的流顶掉。
     */
    const token = ++playToken

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
    // 位置归零只能发生在这里：用户主动换歌
    reportTime(0, true)
    // 换歌了，上一首的「刚拖过进度条」状态不能带过来
    lastSeekAt = 0
    /**
     * 换歌必须重置「已上报坏源」与「连续换源次数」。
     *
     * markedSources 以前是不重置的：第一首歌把某个音源标记为坏之后，
     * 后面每首歌都会因为这个「已经标过」的判断而跳过试听片段检测 ——
     * 于是残缺流一路播到底，播完就自动切歌。这正是「听着听着突然换歌」
     * 最可能的来源。
     */
    markedSources.clear()
    fragmentAttempts.value = 0
    // 重置音频上报的时长，真实值会在加载与播放过程中补上
    mediaDuration.value = 0
    /*
     * 换歌必须把「位置」和「进度」一起清零 —— 不能走 bumpProgress(true)。
     *
     * 原来这里就是 bumpProgress(true)，但 force 的语义是「允许回退到 raw」，
     * 而 raw 是用**尚未重置的 currentTime**（上一首播到的秒数）除以**新歌的时长**算出来的：
     * 上一首播到 200s、新歌 269s → 进度条直接显示 74%，要等新歌第一次 timeupdate 才归零。
     * 用户看到的正是「换歌了进度条还停在上一首的位置」。
     *
     * force 那条路是给「用户主动 seek / 换源落位」用的 —— 那种场景确实该落到 raw（目标位置）；
     * 「换歌」要的是真归零。两件事语义不同，不该共用一个入口。
     */
    currentTime.value = 0
    progress.value = 0
    /*
     * 立刻停掉旧流并进入「换歌窗口期」。
     *
     * 不能只清零就完事：后面要 await 取流，而取流期间旧音频一直在播、
     * 一直按上一首的秒数上报，会把刚清零的进度顶回去（用户报的就是这个）。
     * 同时停掉旧流也符合直觉 —— 点了另一首歌，上一首不该还在响。
     */
    awaitingStream = true
    try {
      ensureAudio().pause()
    } catch {
      /* 元素还没就绪时忽略：真正要紧的是那个标记 */
    }

    try {
      const result = await getPlayUrl({ song, quality: quality.value })
      // 期间用户又点了别的歌：这次结果作废，别去动音频元素
      if (token !== playToken) return

      urlInfo.value = result
      attempts.value = result.attempts ?? []

      const el = ensureAudio()
      el.src = result.url
      await el.play()
      // 迟到的 play() 不该改状态：那一代已经不是当前播放了
      if (token !== playToken) return
      playing.value = true

      // 歌词是锦上添花，失败了不打扰用户
      void loadLyric(song)
      // 记录播放历史；写库失败绝不该影响播放本身（只记真的播起来的）
      void useLibraryStore()
        .recordPlay(song)
        .catch(() => undefined)
    } catch (err) {
      if (token !== playToken) return
      error.value = cleanIpcError(err)
      playing.value = false
    } finally {
      /**
       * 只有「当前这一代」才有资格结束窗口期。
       *
       * 这里必须放 finally：取流抛错、play() 被拒绝（比如自动播放策略）时也要放行，
       * 否则 awaitingStream 会永远为 true，进度条从此彻底不动 —— 那比原来的 bug 更糟。
       * 同时用 token 守住：如果期间用户又点了别的歌，新一代已经自己开了新的窗口期，
       * 旧一代不能把它关掉。
       */
      if (token === playToken) {
        loading.value = false
        awaitingStream = false
      }
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
      // 已经切歌了就别动界面上的歌词：这次失败属于上一首
      if (current.value?.id !== song.id) return
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
    void el
      .play()
      .then(() => {
        playing.value = true
      })
      .catch((err: unknown) => {
        playing.value = false
        error.value = cleanIpcError(err)
      })
  }

  function toggle(): void {
    if (playing.value) pause()
    else resume()
  }

  function seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return
    const el = ensureAudio()

    /**
     * 落点必须夹到「真正能播到的位置」，并只在实际落位成功后改写进度。
     *
     * 这里踩过三个坑，合起来就是「拖进度条有概率从头播放 / 直接切歌 / 进度条归零」：
     *
     *  1. 元数据时长常常长于流的真实时长（音源给试听片段时尤其明显，
     *     标注 290 秒、流里只有 48 秒）。按比例换算出的目标位置早就越过结尾，
     *     浏览器会把它夹到结尾并立刻判定播放结束 → 自动切歌。
     *  2. 拖到 100% 本身也落在结尾上，同样立刻触发结束。
     *  3. 元数据还没就绪时赋值可能根本没生效，而旧代码紧接着就把
     *     currentTime 读回来写进状态 —— 读到的是 0，进度条于是被打回起点。
     *
     * 所以：落点取 seekable 终点往回让 0.3 秒；读回来的值与目标差太远时，
     * 认定这次跳转没生效，保持原进度不动。
     */
    applyPosition(el, seconds)
  }

  /**
   * 可跳转区间的终点（秒）。
   *
   * 拿不到就退回 duration；两者都没有时返回 null ——
   * 旧版这里返回 Number.MAX_SAFE_INTEGER，等于「随便跳」，
   * 元数据没就绪时会把进度写成一个巨大值再被浏览器夹回 0。
   */
  function seekableEnd(el: HTMLAudioElement): number | null {
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
    return null
  }

  function seekByPercent(percent: number): void {
    /**
     * 按「进度条自己的时长基准」换算。
     * 旧版优先用 el.duration，与进度条的基准（duration）可能不是同一个数：
     * 刻度画在 100% 上、落点却按另一个时长算，拖到头就会偏。
     * 落点越界由 seek() 统一夹到可跳转区间内，不必在这里再判一次。
     */
    const total = duration.value
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

      // 保存期间换歌了：译文已经落库，但界面属于新歌，别把旧状态写回去
      if (current.value?.id !== song.id) return true

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
    // 删除期间换歌了：别把上一首的歌词状态写到新歌界面上
    if (current.value?.id !== song.id) return
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

  /** 切换音质：换的是流，不是播放位置 */
  async function setQuality(next: Quality): Promise<void> {
    quality.value = next
    const song = current.value
    if (!song) return
    /**
     * 音质切换同样是「换源」，必须保住位置。
     * 旧实现直接 `await play(song)`，等于把歌从头放一遍 —— 进度条归零。
     * 这里不报坏源：音质不合适是用户的选择，不是音源质量有问题。
     */
    const el = audio
    const at = el && Number.isFinite(el.currentTime) ? el.currentTime : currentTime.value
    await switchSource(song, at, { reason: `切换到 ${next} 音质`, report: false })
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
        // 队列空了：正在取流的这一次作废，别让它在几秒后自己响起来
        playToken += 1
        resetPlaybackState()
        audio?.pause()
      }
    } else if (idx < currentIndex.value) {
      currentIndex.value -= 1
    }
  }

  /** 清空队列时把「当前曲目」相关的状态一起收干净 */
  function resetPlaybackState(): void {
    reportTime(0, true)
    mediaDuration.value = 0
    bumpProgress(true)
    playing.value = false
    loading.value = false
    urlInfo.value = null
    attempts.value = []
  }

  function clearQueue(): void {
    playlist.value = []
    currentIndex.value = -1
    current.value = null
    playToken += 1
    resetPlaybackState()
    if (audio) {
      audio.pause()
      /**
       * 卸载资源用 removeAttribute('src') + load()，不要写 src = ''。
       * 空字符串会被当成一个真实地址去加载（解析成页面地址），
       * 随后必然触发一次 error 事件，界面上就莫名多出一条「音源地址已失效」。
       */
      audio.removeAttribute('src')
      audio.load()
    }
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
