/**
 * 截图探针：把当前路由的真实渲染结果存成 PNG。
 *
 * 用途：改版前后对比、给用户看效果、以及「审计过了但看着别扭」这类只有眼睛能发现的问题。
 * 用法：node scripts/ui-shot.mjs <cdp端口> <输出png> [路由hash]
 *
 * 注意：这个窗口是 GPU 合成的，个别环境下截图会全黑。脚本会对结果做一次
 * 「是不是几乎全黑」的自检并直接报出来，避免拿黑图当证据。
 */
import { writeFileSync } from 'node:fs'

const PORT = Number(process.argv[2] || 9223)
const OUT = process.argv[3] || 'F:\\MusicHub\\.tmp\\ui-shot.png'
const HASH = process.argv[4] || ''

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
    pending.set(i, { resolve, reject })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${expr} })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result?.value
}

await send('Runtime.enable')
await send('Page.enable')

if (HASH) {
  await evaluate(`location.hash = ${JSON.stringify(HASH)}; await new Promise(r=>setTimeout(r,1600)); return 1`)
}
if (HASH === '#/search') {
  /* 搜索页要有内容才看得出效果 */
  await evaluate(`
    const input = document.querySelector('.search-box input')
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '周杰伦')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 200))
      document.querySelector('.search-box button.primary')?.click()
      await new Promise(r => setTimeout(r, 9000))
    }
    return 1`)
}
await new Promise((r) => setTimeout(r, 600))

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
const buf = Buffer.from(shot.data, 'base64')
writeFileSync(OUT, buf)

/* 全黑自检：把 PNG 丢给页面解码，统计非黑像素比例（不引第三方库） */
const blackness = await evaluate(`
  const b64 = ${JSON.stringify(shot.data)}
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64 })
  const c = document.createElement('canvas')
  c.width = img.width; c.height = img.height
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  let dark = 0, total = 0, sumR = 0, sumG = 0, sumB = 0
  for (let i = 0; i < d.length; i += 4 * 37) {
    total += 1
    const r = d[i], g = d[i+1], b = d[i+2]
    sumR += r; sumG += g; sumB += b
    if (r < 12 && g < 12 && b < 12) dark += 1
  }
  return JSON.stringify({ 宽: img.width, 高: img.height, 采样: total, 近黑比例: +(dark/total).toFixed(3), 均色: [Math.round(sumR/total), Math.round(sumG/total), Math.round(sumB/total)] })
`)

console.log(JSON.stringify({ 文件: OUT, 字节: buf.length, 自检: JSON.parse(blackness) }, null, 1))
ws.close()
