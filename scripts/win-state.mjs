/**
 * 最小化 / 还原 Electron 窗口（用于「同一构建、同一次进程」的 (a)/(b) 对照）。
 *
 * 为什么需要它：隐藏窗口里 rAF 完全停摆，会让 CDP 指针命中、Vue 过渡、帧计数
 * 全都失真。要分辨「数据坏」是环境还是代码，唯一干净的办法就是同一进程里
 * 只切换窗口可见性这一个变量。`Browser.setWindowBounds` 走的是浏览器级
 * WebSocket（不是页面级的），所以这里单独连一次。
 *
 * 用法: node scripts/win-state.mjs <port> <minimize|restore|state>
 */
const PORT = Number(process.argv[2] || 9223)
const ACTION = process.argv[3] || 'state'
const BASE = `http://127.0.0.1:${PORT}`

const ver = await (await fetch(`${BASE}/json/version`)).json()
const list = await (await fetch(`${BASE}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
if (!page) {
  console.error(`端口 ${PORT} 上找不到页面`)
  process.exit(2)
}

const ws = new WebSocket(ver.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
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

const { windowId } = await send('Browser.getWindowForTarget', { targetId: page.id })
const before = await send('Browser.getWindowBounds', { windowId })

if (ACTION === 'minimize') {
  await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
} else if (ACTION === 'restore') {
  await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
}

await new Promise((r) => setTimeout(r, 900))
const after = await send('Browser.getWindowBounds', { windowId })
console.log(
  JSON.stringify(
    {
      动作: ACTION,
      最小化之前: before.bounds.windowState,
      最小化之后: after.bounds.windowState,
      窗口尺寸: `${after.bounds.width}x${after.bounds.height}`
    },
    null,
    1
  )
)
ws.close()
process.exit(0)
