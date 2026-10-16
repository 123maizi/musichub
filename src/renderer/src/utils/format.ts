/**
 * LRC 歌词解析
 * 支持普通 LRC（[mm:ss.xx]）与同行的多时间标签。
 */
export interface LyricLine {
  /** 时间点（秒） */
  time: number
  text: string
  /** 该行的译文（无译文时为空） */
  trans?: string
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

/** 解析 LRC 文本为按时间排序的歌词行 */
export function parseLrc(lrc: string): LyricLine[] {
  if (!lrc) return []

  const lines: LyricLine[] = []

  for (const rawLine of lrc.split(/\r?\n/)) {
    const text = rawLine.replace(TIME_TAG, '').trim()
    // 收集这一行上的全部时间标签
    const times: number[] = []
    let match: RegExpExecArray | null
    TIME_TAG.lastIndex = 0
    while ((match = TIME_TAG.exec(rawLine)) !== null) {
      const min = Number(match[1])
      const sec = Number(match[2])
      const fracRaw = match[3] ?? '0'
      // 两位表示百分秒，三位表示毫秒
      const frac = fracRaw.length === 3 ? Number(fracRaw) / 1000 : Number(fracRaw) / 100
      times.push(min * 60 + sec + frac)
    }

    if (times.length === 0) continue
    for (const time of times) {
      lines.push({ time, text })
    }
  }

  return lines.sort((a, b) => a.time - b.time)
}

/**
 * 把译文 LRC 对齐到主歌词上。
 *
 * ── 为什么不能只按「时间戳最近邻」──────────────────────────────────
 * 主歌词与译文经常来自**不同平台**：主歌词可能来自音源脚本或 QQ，
 * 译文来自网易云的官方译文。两家的时间轴本来就不一致，
 * 而旧实现用的是固定 0.5 秒最近邻容差。
 *
 * 实测（scripts/probe-translation-coverage.mjs 打真实接口）：
 *   曲目：Ex-Factor - Lauryn Hill
 *   主歌词 88 行（音源脚本给的，头部还带 Producer/Writer/Sample 这类 credits 行）
 *   译文   65 行（网易云官方译文）
 *   两条时间轴的系统性偏移中位数 **0.74 秒**
 *   → 旧算法只能配上 **15 行**，用户看到的是「一整屏歌词只有一行有翻译」。
 *
 * ── 现在怎么对齐 ────────────────────────────────────────────────────
 *  1. 先估系统性偏移：每条译文找最近的主歌词行，取「有符号时间差」的中位数
 *     （≥4 个样本才认，且钳到 ±5 秒；估不出来就当 0，退回旧路径）
 *  2. 去掉偏移后做**两指针单调对齐** —— 两份 LRC 的行序本来就一致，
 *     单调匹配从结构上排除了「把不相干的两行配到一起」，
 *     这条性质比覆盖率更重要：宁可留空，也不能显示错的译文
 *  3. 单行抖动容差 1 秒（实测这个值能把上面那首从 15 行提到 63 行，
 *     而残留抖动小的曲目不受影响）
 *  4. 最后与旧的最近邻结果比「配上的行数」，取多的那个 ——
 *     任何情况下都不会比旧版更差
 *
 * 实测同一首歌里时间戳本来就对齐的版本（67 行主歌词 + 65 行译文）：
 * 新旧都是 65/65，无回归。
 */
const TRANS_TOLERANCE = 0.5
/** 去掉系统性偏移后允许的单行抖动 */
const ALIGN_TOLERANCE = 1
/** 估偏移时「最近邻」的搜索半径（秒） */
const OFFSET_SEARCH = 6
/** 能接受的最大系统性偏移（秒）；超过它说明这两份 LRC 不是同一条时间轴 */
const MAX_SHIFT = 5
/** 估偏移所需的最少样本数，样本太少时中位数不可信 */
const MIN_OFFSET_SAMPLES = 4

/**
 * 估系统性偏移（秒）：译文时间轴相对主歌词时间轴整体平移了多少。
 * 返回 0 表示估不出来（样本不足或偏移过大），调用方按无偏移处理。
 */
function estimateOffset(main: LyricLine[], trans: LyricLine[]): number {
  const deltas: number[] = []

  for (const item of trans) {
    let bestGap = Number.POSITIVE_INFINITY
    let bestTime = 0
    for (const line of main) {
      const gap = Math.abs(line.time - item.time)
      if (gap < bestGap) {
        bestGap = gap
        bestTime = line.time
      }
      // main 已按时间排序，越过搜索半径之后只会更远
      if (line.time > item.time + OFFSET_SEARCH) break
    }
    if (bestGap <= OFFSET_SEARCH) deltas.push(item.time - bestTime)
  }

  if (deltas.length < MIN_OFFSET_SAMPLES) return 0
  deltas.sort((a, b) => a - b)
  const median = deltas[deltas.length >> 1]
  return Math.abs(median) > MAX_SHIFT ? 0 : median
}

/** 单调对齐：主歌词的有字行与译文行按顺序一一配对，配不上就跳过 */
function alignMonotonic(
  main: LyricLine[],
  trans: LyricLine[],
  offset: number
): Map<number, string> {
  const matched = new Map<number, string>()
  let j = 0

  for (let i = 0; i < main.length; i += 1) {
    const line = main[i]
    if (!line.text) continue
    // 译文行落在这一行之前太多 —— 它是给更靠后的主歌词行准备的，先跳过
    while (j < trans.length && trans[j].time - offset < line.time - ALIGN_TOLERANCE) j += 1
    if (j >= trans.length) break
    if (Math.abs(trans[j].time - offset - line.time) <= ALIGN_TOLERANCE) {
      // 译文与原文一模一样就不必重复显示（这类行通常出现在纯器乐段）
      if (trans[j].text !== line.text) matched.set(i, trans[j].text)
      j += 1
    }
  }

  return matched
}

/** 旧路径：固定 0.5 秒最近邻。保留下来作为兜底，并与新结果比覆盖率 */
function matchNearest(main: LyricLine[], trans: LyricLine[]): Map<number, string> {
  const matched = new Map<number, string>()

  for (let i = 0; i < main.length; i += 1) {
    const line = main[i]
    if (!line.text) continue
    let best: LyricLine | null = null
    let bestGap = Number.POSITIVE_INFINITY

    for (const item of trans) {
      const gap = Math.abs(item.time - line.time)
      if (gap < bestGap) {
        bestGap = gap
        best = item
      }
      if (item.time > line.time + TRANS_TOLERANCE) break
    }

    if (!best || bestGap > TRANS_TOLERANCE) continue
    if (best.text === line.text) continue
    matched.set(i, best.text)
  }

  return matched
}

export function mergeTranslation(lines: LyricLine[], tlyric?: string): LyricLine[] {
  if (!tlyric || !tlyric.trim() || lines.length === 0) return lines

  const trans = parseLrc(tlyric).filter((line) => line.text)
  if (trans.length === 0) return lines

  const offset = estimateOffset(lines, trans)
  const aligned = alignMonotonic(lines, trans, offset)
  const nearest = matchNearest(lines, trans)
  const picked = aligned.size >= nearest.size ? aligned : nearest

  if (picked.size === 0) return lines
  return lines.map((line, index) =>
    picked.has(index) ? { ...line, trans: picked.get(index) } : line
  )
}

/** 解析主歌词 + 译文，一步到位 */
export function parseLrcWithTranslation(lrc: string, tlyric?: string): LyricLine[] {
  return mergeTranslation(parseLrc(lrc), tlyric)
}

/**
 * 这份译文能对上主歌词多少行。
 *
 * 用途是**给译文选项设门槛**：平台搜索是按歌名匹配的，改版、同名不同歌都可能
 * 拿到一份实际上对不上的译文。对不上的译文如果出现在选项里，用户点一下
 * 看到的是一片空白 —— 比不给这个选项更糟。所以渲染层拿到选项后先用这里筛一遍，
 * 0 行的直接不显示，其余按覆盖率从高到低排。
 *
 * 这也是「宽松匹配」敢放开歌手字段的底气：匹配可以松，**能不能用由数据说话**。
 */
export function translationCoverage(lrc: string, tlyric: string): number {
  if (!lrc || !tlyric) return 0
  return mergeTranslation(parseLrc(lrc), tlyric).filter((line) => !!line.trans).length
}

/** 找出当前播放时间对应的歌词行下标 */
export function findLyricIndex(lines: LyricLine[], currentTime: number): number {
  if (lines.length === 0) return -1
  let lo = 0
  let hi = lines.length - 1
  let result = -1

  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= currentTime + 0.15) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}

/** 秒 → mm:ss */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 字节 → 人类可读 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 速度 → 人类可读 */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—'
  return `${formatBytes(bytesPerSecond)}/s`
}

/**
 * 清理 IPC 抛出的错误信息。
 * Electron 会给远程调用异常加上 "Error invoking remote method 'x':" 前缀，
 * 直接展示给用户很难看，这里剥掉。
 */
export function cleanIpcError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^Error:\s*/, '')
    .trim()
}
