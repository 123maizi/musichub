/**
 * 在页面里求值并把结果带回来（CDP Runtime.evaluate 的通用壳）。
 *
 * 为视频录制顺手写的：录制要在页面里跑（canvas + MediaRecorder），
 * 但驱动和落盘必须在 Node 侧，所以要一个稳定的「传代码进去、拿结果出来」的通道。
 *
 * 用法: node scripts/cdp-eval.mjs <端口> <表达式文件> [超时ms]
 *       表达式文件里直接写一个 async IIFE，靠 return 把结果交回来。
 */
import { readFileSync } from 'node:fs'

const PORT = Number(process.argv[2] || 9233)
const EXPR_FILE = process.argv[3]
const TIMEOUT = Number(process.argv[4] || 180000)

if (!EXPR_FILE) {
  console.error('用法: node scripts/cdp-eval.mjs <端口> <表达式文件> [超时ms]')
  process.exit(1)
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('没有可用的页面目标')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
}
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })

await send('Runtime.enable')
const code = readFileSync(EXPR_FILE, 'utf8')

/**
 * 用 awaitPromise + returnByValue 取结果。
 * 页面里的 console 输出不会回流到这里，所以录制脚本要把关键信息放 return 里。
 */
const out = await Promise.race([
  send('Runtime.evaluate', {
    expression: `(async () => { ${code} })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  }),
  new Promise((_, rej) => setTimeout(() => rej(new Error(`求值超时 ${TIMEOUT}ms`)), TIMEOUT))
])

if (out.exceptionDetails) {
  console.error('页面里抛错：')
  console.error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text ?? '(无描述)')
  process.exit(1)
}

const value = out.result?.value
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1))
ws.close()
process.exit(0)
