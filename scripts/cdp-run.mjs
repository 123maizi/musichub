/**
 * 带端口的 evalfile 驱动。
 *
 * scripts/cdp.mjs 把端口硬编码成 9222，多实例并行作业时不够用。
 * 用法: node scripts/cdp-run.mjs <port> <探针文件.mjs>
 *
 * 注意：探针文件会被包进 `(async () => { ... })()` 里执行，
 * 所以里面**不能出现反引号和 ${}**（会被外层模板字符串吃掉），
 * 一律用字符串拼接。
 */
import { readFileSync } from 'node:fs'

const PORT = Number(process.argv[2] || 9222)
const SCRIPT = process.argv[3]
if (!SCRIPT) {
  console.error('用法: node scripts/cdp-run.mjs <port> <探针文件>')
  process.exit(2)
}

const BASE = `http://127.0.0.1:${PORT}`
const list = await (await fetch(`${BASE}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
if (!page) {
  console.error(`端口 ${PORT} 上找不到页面`)
  process.exit(2)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

await send('Runtime.enable')

const src = readFileSync(SCRIPT, 'utf8')
const out = await send('Runtime.evaluate', {
  expression: `(async () => { ${src} })()`,
  awaitPromise: true,
  returnByValue: true
})
if (out.exceptionDetails) {
  const d = out.exceptionDetails
  console.error((d.exception?.description ?? d.text ?? '页面内执行异常').slice(0, 2000))
  process.exit(1)
}
const value = out.result?.value
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
ws.close()
process.exit(0)
