/**
 * LRC 歌词解析
 * 支持普通 LRC（[mm:ss.xx]）与同行的多时间标签。
 */
export interface LyricLine {
  /** 时间点（秒） */
  time: number
  text: string
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
