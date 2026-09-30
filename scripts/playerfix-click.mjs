/**
 * 探针：几何 + 点击穿透 + 键盘寻求（**永久回归集**，每轮 UI 改动都要跑）。
 *
 * 全部走真实 CDP 鼠标事件（不是合成 DOM 事件），所以命中的是浏览器真实的命中测试。
 * 用法：node scripts/playerfix-click.mjs <port>
 *
 * ── 为什么必须保留这个探针 ────────────────────────────────────────────
 * 播放条只有 78px（外壳用 `calc(100vh - var(--playerbar-h))` 算内容高度，不能撑高），
 * 预算分配是：进度命中带 24px（WCAG 2.5.8 的下限，不能再收）+ 控制列 52px。
 * 因此 `.progress-track` 的下沿与播放键上沿**只差 0.5px** —— 这是个「刚好没撞上」的状态：
 * 任何字号/间距微调都可能让那条 24px 透明命中带压到播放键上，
 * 表现出来就是「点播放却 seek」，用户只会觉得播放键坏了，极难归因。
 * 探针里两类断言专门抓这种漂移：
 *   1. 几何：命中带与播放键的纵向交叠必须 ≤ 0（现在是 -0.5px），且两者都 ≥24px；
 *   2. 穿透：点播放键中心后 `playing` 必须翻转、`currentTime` 不得跳变（>3s 视为误 seek）。
 * 顺带验收键盘：聚焦即同步基准、连按 3 次 → 每次正好 5 秒、DOM 与 store 差 ≤2.5s。
 *
 * ── 是否需要按分辨率重算？不需要，但需要重跑 ──────────────────────────
 * 断言全部是**相对量**：宽度/位置都从 `getBoundingClientRect()` 实时量，
 * 点击坐标取播放键矩形中心（没有任何硬编码坐标），两个 ≥24px 断言是绝对阈值。
 * 所以换分辨率/缩放不必改脚本，但**换字号、缩放级别或主题行高后请重跑一次** ——
 * 命中带与播放键只差 0.5px，视觉参数一变就可能翻面（这正是要断言的原因）。
 * 判断标准：`命中带与播放键重叠(px)` 必须 ≤ 0；若变成正数，几何就该重新调。
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
const evaluate = async (expression) => {
  const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (out.exceptionDetails) throw new Error(String(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text).slice(0, 600))
  return out.result?.value
}
await send('Runtime.enable')

/* 先播一首歌（键盘与点击都需要有内容才有效） */
const prep = await evaluate(`(async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const player = pinia._s.get('player')
  if (!(player.current && player.playing)) {
    const res = await window.api.search.search({ keyword: '晴天', limit: 10 })
    const songs = res.platforms.flatMap((p) => p.songs).filter((s) => s.duration >= 120 && s.duration <= 400)
    for (const s of songs.slice(0, 8)) { try { await player.play(s); break } catch (e) {} }
    for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 500)); if (player.playing && player.currentTime > 2) break }
  }
  return JSON.stringify({ 曲: player.current ? player.current.name : null, 播放中: player.playing, 秒: +player.currentTime.toFixed(2), 时长: +player.duration.toFixed(1) })
})()`)

/* ---------- 1) 几何：命中带与控制按钮是否重叠 ---------- */
const geom = await evaluate(`(() => {
  const bar = document.querySelector('.player-bar').getBoundingClientRect()
  const track = document.querySelector('.progress-track').getBoundingClientRect()
  const input = document.querySelector('.progress-input').getBoundingClientRect()
  const play = document.querySelector('.ctrl.main').getBoundingClientRect()
  const prev = document.querySelectorAll('.ctrl')[0].getBoundingClientRect()
  return JSON.stringify({
    播放条: { top: +bar.top.toFixed(1), bottom: +bar.bottom.toFixed(1), h: +bar.height.toFixed(1) },
    命中带: { top: +track.top.toFixed(1), bottom: +track.bottom.toFixed(1), h: +track.height.toFixed(1) },
    range命中区: { top: +input.top.toFixed(1), bottom: +input.bottom.toFixed(1), h: +input.height.toFixed(1) },
    播放键: { top: +play.top.toFixed(1), bottom: +play.bottom.toFixed(1), h: +play.height.toFixed(1), cx: +(play.left + play.width / 2).toFixed(1), cy: +(play.top + play.height / 2).toFixed(1) },
    上一首键: { top: +prev.top.toFixed(1), h: +prev.height.toFixed(1) },
    '命中带与播放键重叠(px)': +(Math.min(track.bottom, play.bottom) - Math.max(track.top, play.top)).toFixed(1),
    'range命中区与播放键重叠(px)': +(Math.min(input.bottom, play.bottom) - Math.max(input.top, play.top)).toFixed(1),
    命中区高度达标: input.height >= 24,
    播放键高度达标: play.height >= 24
  })
})()`)

/* ---------- 2) 点击穿透：点播放键中心，应当切换播放/暂停而不是跳进度 ---------- */
const before = JSON.parse(await evaluate(`(() => { const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('player'); return JSON.stringify({ playing: p.playing, t: +p.currentTime.toFixed(2) }) })()`))
const cy = JSON.parse(geom).播放键.cy
const cx = JSON.parse(geom).播放键.cx
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', clickCount: 1 })
}
await new Promise((r) => setTimeout(r, 600))
const after = JSON.parse(await evaluate(`(() => { const p = document.querySelector('#app').__vue_app__.config.globalProperties.__pinia ? null : null; const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia; const pl = pinia._s.get('player'); return JSON.stringify({ playing: pl.playing, t: +pl.currentTime.toFixed(2), err: pl.error }) })()`))
const clickedPos = JSON.parse(await evaluate(`(() => { const el = document.elementFromPoint(${cx}, ${cy}); return JSON.stringify({ tag: el ? el.tagName : null, cls: el ? String(el.className) : null }) })()`))

/* 再点一次恢复播放 */
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', clickCount: 1 })
}
await new Promise((r) => setTimeout(r, 500))

/* ---------- 3) 键盘：聚焦后按 3 次 →（stepUp 即原生 ArrowRight 的动作） ---------- */
const kb = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const player = pinia._s.get('player')
  const el = document.querySelector('.progress-input')
  el.focus()
  await sleep(150)
  const out = { 步长: el.step, 上限: el.max, 聚焦后DOM: Number(el.value), 聚焦后store: +player.currentTime.toFixed(2) }
  const steps = []
  for (let i = 0; i < 3; i++) {
    const d0 = Number(el.value); const t0 = +player.currentTime.toFixed(2)
    el.stepUp(1)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(250)
    steps.push({ 第几次: i + 1, DOM步进: Number(el.value) - d0, store跳变: +(player.currentTime - t0).toFixed(2), 跳后DOM: Number(el.value), 跳后store: +player.currentTime.toFixed(2), 差: +(Number(el.value) - player.currentTime).toFixed(2) })
  }
  out.按键序列 = steps
  out.每次正好5秒 = steps.every((s) => s.DOM步进 === 5)
  out.方向正确 = steps.every((s, i) => i === 0 || s.跳后store > steps[i - 1].跳后store)
  out.位置与store一致 = steps.every((s) => Math.abs(s.差) <= 2.5)
  const v0 = el.value
  await sleep(2500)
  out.播放期间value未被写 = el.value === v0
  out.最终 = { store秒: +player.currentTime.toFixed(2), DOM值: Number(el.value), playing: player.playing }
  return JSON.stringify(out)
})()`)

console.log(JSON.stringify({ 准备: JSON.parse(prep), 几何: JSON.parse(geom), 点击播放键: { 点击前: before, 点击后: after, 命中的元素: clickedPos, 是否切换了播放态: before.playing !== after.playing, 是否误跳了进度: Math.abs(after.t - before.t) > 3 }, 键盘: JSON.parse(kb) }, null, 1))
ws.close()
process.exit(0)
