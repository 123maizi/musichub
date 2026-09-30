/**
 * 截图（精简版）：只做 captureScreenshot + 落盘 + 体积自检。
 *
 * 为什么不做「页面内解码统计黑像素」：把 ~1MB 的 base64 塞进 Runtime.evaluate
 * 会卡住（实测挂死）。这里改用体积启发式 —— 纯黑 PNG 压缩后只有几 KB，
 * 真实界面（文字/刻线/封面）至少几十 KB。
 *
 * 用法：node scripts/ui-shot2.mjs <端口> <输出png> [路由hash] [超时ms]
 */
import { writeFileSync, statSync } from 'node:fs'

const PORT = Number(process.argv[2] || 9223)
const OUT = process.argv[3] || 'F:\\MusicHub\\.tmp\\ui-shot.png'
const HASH = process.argv[4] || ''
const TIMEOUT = Number(process.argv[5] || 20000)

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) throw new Error('找不到渲染进程 target')

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
await new Promise((r, j) => {
  ws.onopen = r
  ws.onerror = j
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
    const i = ++id
    const timer = setTimeout(() => {
      pending.delete(i)
      reject(new Error(`${method} 超时 ${TIMEOUT}ms`))
    }, TIMEOUT)
    pending.set(i, {
      resolve: (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      }
    })
    ws.send(JSON.stringify({ id: i, method, params }))
  })

await send('Runtime.enable')
await send('Page.enable')
if (HASH) {
  await send('Runtime.evaluate', {
    expression: `location.hash = ${JSON.stringify(HASH)}; 1`,
    returnByValue: true
  })
  await new Promise((r) => setTimeout(r, 1500))
}

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
const buf = Buffer.from(shot.data, 'base64')
writeFileSync(OUT, buf)
const size = statSync(OUT).size
console.log(
  JSON.stringify(
    {
      文件: OUT,
      字节: size,
      判定: size > 20000 ? '有内容（体积远大于纯黑图）' : '可疑：可能是全黑/空白',
      路由: HASH || '(当前)'
    },
    null,
    1
  )
)
ws.close()
