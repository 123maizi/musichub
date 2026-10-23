/**
 * 截一张界面图（CDP Page.captureScreenshot）。
 *
 * 为什么自己写：REA 的 list_browser_targets 只收 HTTP(S) 目标，而我们是
 * `file://` 加载的页面（excluded.unsupported_url=1），所以走不了它那套。
 * 这里直接连 CDP，自己挑 page 目标、自己截。
 *
 * 用法: node scripts/shot.mjs <端口> <输出png> [路由hash]
 */
import { writeFileSync } from 'node:fs'

const PORT = Number(process.argv[2] || 9233)
const OUT = process.argv[3] || '.tmp/shot.png'
const HASH = process.argv[4] || ''

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('没有可截图的页面目标')
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
await send('Page.enable')

const evaluate = async (expression) => {
  const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text)
  return out.result?.value
}

if (HASH) {
  await evaluate(`location.hash = ${JSON.stringify(HASH)}`)
  await new Promise((r) => setTimeout(r, 1800))
}

// 顺便把品牌标的事实读出来，别只凭一张图下结论
const facts = await evaluate(`(() => {
  const img = document.querySelector('.brand')
  return {
    tag: img ? img.tagName : null,
    src: img ? String(img.getAttribute('src') || '') : null,
    natural: img ? [img.naturalWidth, img.naturalHeight] : null,
    box: img ? [Math.round(img.getBoundingClientRect().width), Math.round(img.getBoundingClientRect().height)] : null,
    title: document.title,
    size: [window.innerWidth, window.innerHeight]
  }
})()`)

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
console.log(JSON.stringify({ 截图: OUT, ...facts }, null, 1))
ws.close()
process.exit(0)
