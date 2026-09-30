/**
 * player-fix 专用：用 CDP 的 Performance 域量「进度条驱动方式的布局成本」。
 *
 * 目的：把「一次进度更新」拆开归因，看布局到底是谁引起的。
 * 用法：node scripts/playerfix-perf.mjs <port> [次数] [模式]
 *
 * ── 已知且**有意保留**的一处开销（不要当待办去压）────────────────────
 * 完整路径（`seek`）会比地板值多约 +1.07 次布局/更新，归因已做到节点级：
 * 全部来自**时钟文字**（`formatTime(currentTime)`，同一秒内字符串不变 → Vue 不写 DOM）。
 * 真实播放里它每秒才变一次，而进度条每秒更新 4 次以上；为了压掉这 1 次/秒
 * 去动时钟渲染，风险大于收益。Lead 已裁定为「已评估例外」。
 * 进度条自身（`var` 模式）与地板值相同 —— 那才是本轮要保证的东西。
 *   none          只等帧（地板值）
 *   var           只改轨道的 --p（填充 + 圆点本身）
 *   width         只改填充的 inline width（旧写法）
 *   left          只改圆点的 inline left（旧写法）
 *   input         只改 range 的 value
 *   seek          完整走 store（默认）
 *   seek-observe  完整走 store，并记录改了哪些 DOM 节点
 *
 * 注意：等帧一律用 rAF + 120ms 超时兜底 —— 窗口被遮挡/最小化时 rAF 会被节流，
 * 只 await rAF 会让探针挂死。
 */
const PORT = Number(process.argv[2] || 9222)
const UPDATES = Number(process.argv[3] || 200)
const MODE = process.argv[4] || 'seek'

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
await send('Performance.enable')

/**
 * 把窗口置前再测：窗口被遮挡/最小化时 rAF 会被节流，但节流不是产品行为，
 * 会污染测量。置前之后测量才是干净的（探针侧解决，不污染被测代码）。
 */
try {
  await send('Page.enable')
  await send('Page.bringToFront')
} catch {
  /* 某些版本没有 Page 域，忽略即可 */
}

const metrics = async () => {
  const r = await send('Performance.getMetrics')
  const out = {}
  for (const m of r.metrics) out[m.name] = m.value
  return out
}

const evaluate = async (expression) => {
  const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (out.exceptionDetails) {
    const d = out.exceptionDetails
    throw new Error((d.exception?.description ?? d.text ?? '页面内执行异常').slice(0, 1200))
  }
  return out.result?.value
}

/**
 * 等一帧：**纯 rAF**，不给超时兜底。
 *
 * 为什么不能用「rAF + 超时」：超时会让驱动跑得比帧快，Chrome 把这一串
 * 样式/布局变更合并到最后一次绘制，于是所有模式的 LayoutCount 增量都变成 0 ——
 * 那不是「优化到 0」，是尺子坏了（我踩过这个坑，所以这里只留纯 rAF）。
 * 仍然用 Promise.race 在 2 秒后打一个「本轮被节流」的标记：探针不会挂死，
 * 但这一轮数据必须作废，不能当成测量结果。
 */
const FRAME =
  'await Promise.race([new Promise((r) => requestAnimationFrame(() => r())), new Promise((r) => setTimeout(() => { window.__pfStalled = true; r() }, 2000))])'

const PRELUDE = `
  const N = ${UPDATES}
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const player = pinia._s.get('player')`

const OBSERVER = `
  const log = []
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') log.push('attr:' + (r.target.className || r.target.nodeName) + '[' + r.attributeName + ']')
      else if (r.type === 'characterData') log.push('text:' + (r.target.parentElement?.className || '?'))
      else log.push('child:' + (r.target.className || r.target.nodeName))
    }
  })
  mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })`

const DRIVERS = {
  none: `${PRELUDE}
    for (let i = 0; i < N; i++) { ${FRAME} }`,
  var: `${PRELUDE}
    const rail = document.querySelector('.progress-rail') || document.querySelector('.seek-rail')
    for (let i = 0; i < N; i++) { rail.style.setProperty('--p', String(10 + (i % 80))); ${FRAME} }`,
  width: `${PRELUDE}
    const fill = document.querySelector('.progress-fill') || document.querySelector('.seek-fill')
    for (let i = 0; i < N; i++) { fill.style.width = (10 + (i % 80)) + '%'; ${FRAME} }`,
  left: `${PRELUDE}
    const knob = document.querySelector('.progress-knob') || document.querySelector('.seek-knob')
    for (let i = 0; i < N; i++) { knob.style.left = (10 + (i % 80)) + '%'; ${FRAME} }`,
  input: `${PRELUDE}
    const input = document.querySelector('.progress-input') || document.querySelector('.seek')
    for (let i = 0; i < N; i++) { input.value = String(10 + (i % 80)); ${FRAME} }`,
  seek: `${PRELUDE}
    for (let i = 0; i < N; i++) { player.seek(40 + (i % 40) * 0.5); ${FRAME} }`,
  'seek-observe': `${PRELUDE}
    ${OBSERVER}
    for (let i = 0; i < N; i++) { player.seek(40 + (i % 40) * 0.5); ${FRAME} }
    await new Promise((r) => setTimeout(r, 50))
    mo.disconnect()
    const counts = {}
    for (const k of log) counts[k] = (counts[k] || 0) + 1
    return JSON.stringify({ 模式: 'seek-observe', 更新次数: N, 变更总数: log.length, 按类型: counts })`
}

const driverBody = DRIVERS[MODE] ?? DRIVERS.seek

/* 先确保有一首歌在播（进度条才有真实读数） */
await evaluate('window.__pfStalled = false')
const prep = await evaluate(`
(async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const player = pinia._s.get('player')
  if (player.current && player.playing) return JSON.stringify({ 复用: player.current.name, 秒: +player.duration.toFixed(1) })
  const res = await window.api.search.search({ keyword: '晴天', limit: 10 })
  const songs = res.platforms.flatMap((p) => p.songs).filter((s) => s.duration >= 120 && s.duration <= 400)
  for (const s of songs.slice(0, 8)) {
    try { await player.play(s); break } catch (e) { /* 换下一首 */ }
  }
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (player.playing && player.currentTime > 1) break
  }
  return JSON.stringify({ 新播: player.current ? player.current.name : null, 时长: +player.duration.toFixed(1) })
})()`)

/* 预热，避免把首帧算进来 */
await evaluate(`(async () => { ${PRELUDE}
  for (let i = 0; i < 8; i++) { player.seek(30 + i); ${FRAME} }
  return 'warm' })()`)

const before = await metrics()

const drive = await evaluate(`(async () => { ${driverBody}
  return JSON.stringify({ 模式: ${JSON.stringify(MODE)}, 更新次数: ${UPDATES} }) })()`)

const after = await metrics()

const keys = ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration']
const diff = {}
for (const k of keys) {
  if (before[k] === undefined) continue
  diff[k] = {
    增量: +(after[k] - before[k]).toFixed(4),
    每次更新: +((after[k] - before[k]) / UPDATES).toFixed(4)
  }
}

console.log(
  JSON.stringify(
    {
      端口: PORT,
      页面: page.url,
      被节流: await evaluate('!!window.__pfStalled'),
      预热: JSON.parse(prep),
      驱动: JSON.parse(drive),
      指标: diff
    },
    null,
    1
  )
)
ws.close()
process.exit(0)
