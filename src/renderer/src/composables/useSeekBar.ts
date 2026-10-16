import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { usePlayerStore } from '../stores/player'

/**
 * 进度条交互（底部播放条的缩略条 与 正在播放页的大进度条 共用同一套）。
 *
 * ── 为什么合并成一份 ───────────────────────────────────────────────────
 * 两条进度条原本各写了一份几乎相同的逻辑，然后各自演化出了不同的毛病。
 * 用户这次的报告正是「缩略条坏了、大条还是好的」—— 同一份状态、两套实现，
 * 坏的那一条必然只有它自己坏。合并之后，修一处就是两条一起修。
 *
 * ── 这一版修掉的两个真实缺陷 ─────────────────────────────────────────
 *
 * 【一】提交不能只靠 `change`（缩略条「滑到最开头后条子卡住不动」的根因）
 *
 * 事件取证（scripts/seek-lab.mjs trace，真实鼠标经 CDP Input 派发）：
 *
 *   成功那一次：pointerdown mousedown input×3 pointerup mouseup **change** click lostpointercapture
 *   失败那一次：pointerdown mousedown input×3 pointerup mouseup click lostpointercapture
 *
 * 即 **Chromium 的 range 会漏发 `change`**（拖动途中 input 全到，松手后 change 没来），
 * 两种情形逐字对比只差这一个事件，且同一台机器上时好时坏。
 * 而我们的提交、`seeking=false`、`player.seek()` 全都挂在 `change` 上，于是漏发时：
 *   · `seeking` 一直是 true → 显示值被 seekValue 钉住 → **条子不动**
 *   · `player.seek()` 没跑 → 音频继续在旧位置播 → **歌曲不跟随缩略条**
 *   · 2 秒看门狗只把 seeking 放开、**把这一下拖动整个丢掉** → 条子又弹回真实位置
 * 三个现象合起来就是用户描述的「拖到最开头，歌不跟着走，条子也不动」。
 *
 * 所以现在：`pointerup` / `lostpointercapture` / `pointercancel` 任何一个到了就提交，
 * 另外还有一道「拖动静默 320ms 就当作结束」的兜底 —— 就算松手事件丢在窗口外也照样生效。
 *
 * 【二】落点按指针像素算，不按 range 的 value（「点击跳转有偏差」的根因）
 *
 * 原生 range 的 value 会被 `step` 量化。我们为了键盘手感保留 step=5（不能改小，
 * 见 onSeekKeydown 的实测记录），于是点击/拖动的落点最多差半个步长 = 2.5 秒；
 * 在 1320px 的轨道上就是 12px 的可见偏差，拖起来还会一跳一跳（每 5 秒才动一格）。
 * 现在预览与落点都由 `clientX` 反算（与 Chromium 同样的「两端各内缩半个滑块」映射），
 * step 继续只服务键盘。
 */
export function useSeekBar() {
  const player = usePlayerStore()

  const seeking = ref(false)
  /** 拖动中的预览位置（0~100），只由指针驱动 */
  const seekValue = ref(0)
  const seekInputEl = ref<HTMLInputElement | null>(null)
  const seekMax = computed(() => Math.max(0, Math.floor(player.duration || 0)))

  /**
   * 原生滑块宽度（px）。必须与 CSS 里 `::-webkit-slider-thumb` 的 width 一致 ——
   * Chromium 的可点区间按「半个滑块宽」两端内缩，换算落点时要减掉它。
   */
  const NATIVE_THUMB = 2
  /** 指针松手后多久之内收到 `change`，认定为同一手势（避免用被量化的 value 二次提交） */
  const SAME_GESTURE_MS = 500
  /** 拖动静默多久算结束（松手事件丢失时的兜底提交） */
  const DRAG_IDLE_MS = 320

  let pointerActive = false
  let pointerX = 0
  let pointerUpAt = 0
  /** 最近提交的秒数与时间，用于压掉**同一手势内**的重复事件 */
  let lastCommit = Number.NaN
  let lastCommitAt = 0

  /* ------------------------------ 换算 ------------------------------ */

  function percentOf(seconds: number): number {
    const total = player.duration
    if (!(total > 0)) return 0
    return Math.max(0, Math.min(100, (seconds / total) * 100))
  }

  /**
   * 指针横坐标 → 秒。
   * 映射与 Chromium 对 range 的处理一致：可点区间两端各内缩半个滑块宽。
   * 拿不到几何信息时返回 null，调用方退回原生 value。
   */
  function secondsFromPointer(clientX: number): number | null {
    const el = seekInputEl.value
    const total = player.duration
    if (!el || !(total > 0)) return null
    const rect = el.getBoundingClientRect()
    const usable = rect.width - NATIVE_THUMB
    if (!(usable > 0)) return null
    const ratio = (clientX - rect.left - NATIVE_THUMB / 2) / usable
    return Math.max(0, Math.min(1, ratio)) * total
  }

  /** 当前拖动位置（秒）：指针优先，退化时用预览百分比反算 */
  function currentSeconds(): number {
    if (pointerActive) {
      const byPointer = secondsFromPointer(pointerX)
      if (byPointer !== null) return byPointer
    }
    return (seekValue.value / 100) * (player.duration || 0)
  }

  /* ------------------------------ 显示 ------------------------------ */

  /**
   * 位置来源唯一化：拖动中 = 指针；提交后 = 钉住的目标（等 store 追上，阈值 1%，600ms 兜底）；
   * 其余时间 = store 的真实进度。否则 `seeking=false` 的那一刻填充会先弹回旧位置、
   * 等 store 追上再跳 —— 用户看到的就是「进度条在鼠标前面/后面」。
   */
  const pendingSeek = ref<number | null>(null)
  let pendingTimer: ReturnType<typeof setTimeout> | null = null

  function releasePending(): void {
    pendingSeek.value = null
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
  }

  function holdSeekTarget(percent: number): void {
    pendingSeek.value = percent
    if (pendingTimer) clearTimeout(pendingTimer)
    pendingTimer = setTimeout(releasePending, 600)
  }

  const displayProgress = computed(() => {
    if (seeking.value) return seekValue.value
    if (pendingSeek.value !== null) return pendingSeek.value
    return player.progress
  })

  /** 大进度条左侧的秒数文本：拖动中显示预览位置 */
  const displayTime = computed(() =>
    seeking.value && player.duration > 0 ? (seekValue.value / 100) * player.duration : player.currentTime
  )

  watch(
    () => player.progress,
    (p) => {
      if (pendingSeek.value !== null && Math.abs(p - pendingSeek.value) < 1) releasePending()
    }
  )

  /* ------------------------------ 原生 range 基准 ------------------------------ */

  function syncSeekInput(): void {
    const el = seekInputEl.value
    if (!el) return
    /**
     * 拖动中一次都不要写：写 value 会让原生滑块跳位，
     * 而我们的显示已经由指针接管，这里再去改它只会互相打架。
     */
    if (seeking.value) return
    const seconds = player.currentTime
    const next = String(Math.round(seconds))
    if (el.value !== next) el.value = next
  }

  /**
   * 键盘改值前先把基准对齐到真实进度：keydown 早于浏览器对 range 的默认步进，
   * 同步完紧接着的 ←/→ 就是「从当前真实位置再走 5 秒」。
   *
   * ⚠️ 别改成「拦截 ←/→ 手动 ±5 秒 + 把 step 调细」—— 实测会让点击与拖动一起坏掉
   * （误差 −12/−76.6/−141px、回弹 146 帧）。step=5 保持不变。
   */
  function onSeekKeydown(event: KeyboardEvent): void {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']
    if (keys.includes(event.key)) syncSeekInput()
  }

  /* ------------------------------ 提交 ------------------------------ */

  /**
   * 提交落点。幂等只认「同一手势内的重复事件」（pointerup + change + click 会连着来），
   * 所以去重条件必须带**时间窗**。
   *
   * ⚠️ 只比值不去重时间会出大问题：用户把条子拖到某个位置、播了一会儿、又拖回同一个位置，
   * 第二次会被当成重复而**整个丢掉**（音频不动，界面上却像拖成功了）。
   * 这是我在拖动工况矩阵里抓到的：连续 4 个「拖到 0」的用例只有第 1 个生效，
   * 后面 3 个都被自己的去重挡掉了 —— 正是用户报的「拖了没反应」。
   */
  function commit(seconds: number, why: string): void {
    if (!Number.isFinite(seconds) || seconds < 0) return
    if (!player.current) return
    const now = Date.now()
    if (now - lastCommitAt < 250 && Math.abs(seconds - lastCommit) < 0.05) {
      seeking.value = false
      return
    }
    lastCommit = seconds
    lastCommitAt = now
    const percent = percentOf(seconds)
    seekValue.value = percent
    holdSeekTarget(percent)
    seeking.value = false
    armIdle.cancel()
    player.seek(seconds)
    syncSeekInput()
    void why
  }

  /** 用当前拖动位置提交 */
  function commitCurrent(why: string): void {
    if (!seeking.value) return
    commit(currentSeconds(), why)
  }

  /* ------------------------------ 静默兜底 ------------------------------ */

  /**
   * 拖动静默计时器。
   *
   * 存在的意义：松手事件可能根本到不了页面（甩到窗口外松手、系统吞掉 pointerup）。
   * 那条路径下旧代码会把整段拖动丢掉；现在改成「静默 320ms 就按当前预览位置提交」——
   * 用户要的位置就是条子上的位置，不会白拖。
   * 连续拖动时每个事件都会重排这个计时器，正常拖动不会中途提交。
   */
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  function armIdle(): void {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimer = null
      commitCurrent('静默兜底')
    }, DRAG_IDLE_MS)
  }
  armIdle.cancel = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
  }

  /* ------------------------------ 指针 ------------------------------ */

  function setPreviewFromPointer(clientX: number): void {
    pointerX = clientX
    const seconds = secondsFromPointer(clientX)
    if (seconds === null) return
    seekValue.value = percentOf(seconds)
  }

  function onSeekPointerDown(event: PointerEvent): void {
    if (!player.current || player.duration <= 0) return
    pointerActive = true
    seeking.value = true
    setPreviewFromPointer(event.clientX)
    armIdle()
  }

  function onSeekPointerMove(event: PointerEvent): void {
    if (!pointerActive) return
    /**
     * 静默兜底提交过之后用户还在继续拖（按住不动超过 DRAG_IDLE_MS 再拖），
     * 这里要重新进入拖动态，否则预览会停在兜底那一刻、看着像卡住。
     */
    if (!seeking.value) seeking.value = true
    setPreviewFromPointer(event.clientX)
    armIdle()
  }

  function onSeekPointerUp(event: PointerEvent): void {
    if (!pointerActive) return
    pointerActive = false
    pointerUpAt = Date.now()
    setPreviewFromPointer(event.clientX)
    commitCurrent('pointerup')
  }

  /** 指针捕获丢失（Chromium 在拖动结束时也会发这个） */
  function onSeekLostCapture(): void {
    if (!pointerActive) return
    pointerActive = false
    pointerUpAt = Date.now()
    commitCurrent('lostpointercapture')
  }

  /** 触摸被系统接管（滚动等）时也要落位，否则这一下白拖 */
  function onSeekPointerCancel(): void {
    if (!pointerActive) return
    pointerActive = false
    pointerUpAt = Date.now()
    commitCurrent('pointercancel')
  }

  /** 窗口级兜底：指针在控件外松手时，元素上收不到 pointerup */
  function onWindowPointerUp(): void {
    if (!pointerActive) return
    pointerActive = false
    pointerUpAt = Date.now()
    commitCurrent('window.pointerup')
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerup', onWindowPointerUp, true)
    window.addEventListener('pointercancel', onWindowPointerUp, true)
  }

  /* ------------------------------ input / change ------------------------------ */

  /**
   * `input` 只服务两种情况：
   *   · 键盘（没有指针在手）
   *   · 原生 range 自己算出的值（点击跳到落点也是走这里）
   * 指针拖动中一律忽略 —— 预览已经由 pointermove 逐像素接管，
   * 而 range 的 `input` 要跨过 step 才发一次，跟不上指针。
   */
  function onSeekInput(event: Event): void {
    if (pointerActive) return
    const value = Number((event.target as HTMLInputElement).value)
    if (!Number.isFinite(value)) return
    seeking.value = true
    seekValue.value = percentOf(value)
    armIdle()
  }

  /**
   * `change` **不能**当成唯一提交入口（实测 Chromium 会漏发，见文件头）。
   * 这里只负责键盘与「只发 change 不发 input」的少数情形；
   * 指针手势刚结束时的 change 一律忽略，否则会拿被 step 量化的 value 覆盖掉精确落点。
   */
  function onSeekCommit(event: Event): void {
    if (Date.now() - pointerUpAt < SAME_GESTURE_MS) return
    const value = Number((event.target as HTMLInputElement).value)
    if (!Number.isFinite(value)) return
    if (!seeking.value && Math.abs(value - lastCommit) < 0.001) return
    commit(value, 'change')
  }

  /* ------------------------------ 生命周期 ------------------------------ */

  function reset(): void {
    pointerActive = false
    seeking.value = false
    releasePending()
    armIdle.cancel()
    syncSeekInput()
  }

  /** 换歌：清掉钉住的目标，否则界面会停在上一首的百分比上 */
  watch(() => player.current?.id, reset)
  watch(() => player.playing, syncSeekInput)

  onBeforeUnmount(() => {
    armIdle.cancel()
    if (pendingTimer) clearTimeout(pendingTimer)
    pendingTimer = null
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerup', onWindowPointerUp, true)
      window.removeEventListener('pointercancel', onWindowPointerUp, true)
    }
  })

  return {
    seeking,
    seekValue,
    seekInputEl,
    seekMax,
    pendingSeek,
    displayProgress,
    displayTime,
    syncSeekInput,
    onSeekKeydown,
    onSeekInput,
    onSeekCommit,
    onSeekPointerDown,
    onSeekPointerMove,
    onSeekPointerUp,
    onSeekLostCapture,
    onSeekPointerCancel
  }
}
