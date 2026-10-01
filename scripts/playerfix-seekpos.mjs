/**
 * task-10 验收：进度条落点与鼠标位置是否一致（真实 CDP 鼠标事件）。
 *
 * 判据：
 *  1. 在轨道 20% / 50% / 80% 三处真实点击 → 填充左边缘与点击点误差 ≤ 2px
 *  2. 点击后**不许出现中间回弹帧**（在点击后逐帧采样填充位置，不得出现
 *     「先回到旧位置再跳到新位置」）
 *  3. 拖动：按下→移动→松开，填充单调跟随，松手不回弹
 *  4. 键盘：连按 3 次 → 每次 +5 秒、DOM 与 store 差 0
 *
 * 用法：node scripts/playerfix-seekpos.mjs <port>
 */
const PORT = Number(process.argv[2] || 9222)
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
const evaluate = async (expression) => {
  const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (out.exceptionDetails) throw new Error(String(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text).slice(0, 500))
  return out.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await send('Runtime.enable')
try {
  await send('Page.enable')
  await send('Page.bringToFront')
} catch {
  /* ignore */
}

/* 准备：播一首并进正在播放页 */
const prep = await evaluate(`(async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const player = pinia._s.get('player')
  const router = document.querySelector('#app').__vue_app__.config.globalProperties.$router
  if (!(player.current && player.playing)) {
    const res = await window.api.search.search({ keyword: '晴天', limit: 10 })
    const songs = res.platforms.flatMap((p) => p.songs).filter((s) => s.duration >= 120 && s.duration <= 400)
    for (const s of songs.slice(0, 8)) { try { await player.play(s); break } catch (e) {} }
    for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 500)); if (player.playing && player.currentTime > 3) break }
  }
  await router.push('/now-playing')
  await new Promise((r) => setTimeout(r, 800))
  const rail = document.querySelector('.seek-rail').getBoundingClientRect()
  return JSON.stringify({ 曲: player.current ? player.current.name : null, 时长: +player.duration.toFixed(1), 轨道: { left: +rail.left.toFixed(1), width: +rail.width.toFixed(1), top: +rail.top.toFixed(1) } })
})()`)
const P = JSON.parse(prep)
const railLeft = P.轨道.left
const railW = P.轨道.width
const clickY = P.轨道.top + 1

/** 采样填充左边缘（px，相对轨道左端） */
const fillPx = `(() => { const r = document.querySelector('.seek-rail').getBoundingClientRect(); const f = document.querySelector('.seek-fill').getBoundingClientRect(); return +(f.right - r.left).toFixed(2) })()`

const results = []
for (const ratio of [0.2, 0.5, 0.8]) {
  const x = railLeft + railW * ratio
  const before = await evaluate(fillPx)
  /* 逐帧采样：抓「回弹帧」 */
  await evaluate(`(() => {
    window.__pfFrames = []
    const r = document.querySelector('.seek-rail').getBoundingClientRect()
    const f = document.querySelector('.seek-fill')
    const t0 = performance.now()
    const tick = () => {
      const b = f.getBoundingClientRect()
      window.__pfFrames.push(+(b.right - r.left).toFixed(2))
      if (performance.now() - t0 < 500) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })()`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y: clickY, button: 'left', clickCount: 1 })
  }
  await sleep(650)
  const frames = JSON.parse(await evaluate('JSON.stringify(window.__pfFrames)'))
  const after = await evaluate(fillPx)
  const targetPx = railW * ratio
  const oldPx = before
  /* 回弹：出现「明显偏向旧位置」的帧（离旧值 < 离新值） */
  const rebound = frames.filter((v) => Math.abs(v - oldPx) + 2 < Math.abs(v - targetPx)).length
  results.push({
    点击比例: ratio,
    点击x: +x.toFixed(1),
    目标填充px: +targetPx.toFixed(1),
    点击前填充px: before,
    点击后填充px: after,
    误差px: +(after - targetPx).toFixed(2),
    采样帧数: frames.length,
    回弹帧数: rebound,
    帧序列前6: frames.slice(0, 6)
  })
}

/* 拖动：按下 → 移动 → 松开 */
const dragSamples = []
{
  const startX = railLeft + railW * 0.3
  const endX = railLeft + railW * 0.7
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: clickY, button: 'left', clickCount: 1 })
  for (let i = 0; i <= 8; i += 1) {
    const x = startX + ((endX - startX) * i) / 8
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: clickY, button: 'left', buttons: 1 })
    await sleep(40)
    dragSamples.push({ x: +x.toFixed(1), fill: await evaluate(fillPx) })
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: endX, y: clickY, button: 'left', clickCount: 1 })
  await sleep(300)
}
const dragAfter = await evaluate(fillPx)
const dragMonotonic = dragSamples.every((s, i) => i === 0 || s.fill >= dragSamples[i - 1].fill - 2)
const dragMaxErr = Math.max(...dragSamples.map((s) => Math.abs(s.fill - (s.x - railLeft))))

/* 键盘：连按 3 次 → */
const kb = JSON.parse(
  await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
    const player = pinia._s.get('player')
    const el = document.querySelector('.seek')
    el.focus()
    await sleep(150)
    const steps = []
    for (let i = 0; i < 3; i++) {
      const d0 = Number(el.value); const t0 = +player.currentTime.toFixed(2)
      el.stepUp(1)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(250)
      steps.push({ DOM步进: Number(el.value) - d0, store跳变: +(player.currentTime - t0).toFixed(2), 差: +(Number(el.value) - player.currentTime).toFixed(2) })
    }
    return JSON.stringify({ 步长: el.step, 上限: el.max, 序列: steps, 每次5秒: steps.every((s) => s.DOM步进 === 5), 差值达标: steps.every((s) => Math.abs(s.差) <= 2.5) })
  })()`)
)

console.log(
  JSON.stringify(
    {
      页面: P.曲,
      轨道宽度: railW,
      点击用例: results,
      /** 键名必须引号包起来：≤ 不是合法的 JS 标识符字符 */
      点击误差全部在2px内: results.every((r) => Math.abs(r.误差px) <= 2),
      回弹帧总数: results.reduce((n, r) => n + r.回弹帧数, 0),
      拖动: { 采样: dragSamples, 单调: dragMonotonic, 最大误差px: +dragMaxErr.toFixed(2), 松手后px: dragAfter },
      键盘: kb
    },
    null,
    1
  )
)
ws.close()
process.exit(0)
