/**
 * 错误描述工具
 *
 * 为什么不能直接用 `err instanceof Error`：
 * 音源脚本运行在 vm 沙箱里，它抛出的 Error 来自另一个 realm，
 * 构造器与宿主不是同一个，`instanceof Error` 会返回 false ——
 * 于是 message 和 stack 全部丢失，音源报错变得完全无法诊断。
 *
 * 因此这里一律走「鸭子类型」判断，绝不使用 instanceof。
 */

interface ErrorLike {
  message?: unknown
  stack?: unknown
  name?: unknown
}

/** 取错误信息（单行） */
export function errorMessage(err: unknown): string {
  if (err === null || err === undefined) return '未知错误'
  if (typeof err === 'string') return err
  if (typeof err === 'object') {
    const message = (err as ErrorLike).message
    if (typeof message === 'string' && message) return message
  }
  try {
    return String(err)
  } catch {
    return '未知错误'
  }
}

/** 取错误堆栈 */
export function errorStack(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const stack = (err as ErrorLike).stack
    if (typeof stack === 'string' && stack) return stack
  }
  return undefined
}

/** 错误信息 + 堆栈，用于日志与音源诊断 */
export function describeError(err: unknown): string {
  const message = errorMessage(err)
  const stack = errorStack(err)
  if (!stack) return message
  const cleaned = truncateStack(stack)
  // 有些引擎的 stack 已包含 message，避免重复输出
  return cleaned.includes(message) ? cleaned : `${message}\n${cleaned}`
}

/**
 * 截断堆栈里的超长行。
 *
 * 混淆过的音源脚本常被压成一整行（见过 130 万字符的），
 * V8 打印堆栈时会连带把整行源码吐出来，一条日志就能冲爆几十 KB。
 * 位置信息（文件:行:列）在行首已经保留，源码原文没有价值。
 */
function truncateStack(stack: string, maxLineLength = 400, maxLines = 30): string {
  return stack
    .split('\n')
    .slice(0, maxLines)
    .map((line) =>
      line.length > maxLineLength
        ? `${line.slice(0, maxLineLength)} …[源码过长，已截断 ${line.length - maxLineLength} 字符]`
        : line
    )
    .join('\n')
}

/** 取错误 name（如 TypeError / RangeError） */
export function errorName(err: unknown): string {
  if (err && typeof err === 'object') {
    const name = (err as ErrorLike).name
    if (typeof name === 'string' && name) return name
  }
  return 'Error'
}
