/**
 * 交错 A/B（A/B/A/B/A/B）抵消机器漂移：
 *   A = 当前实现（伪元素覆盖层 + .table 单一层叠上下文）
 *   B = 关掉两层伪元素（对照组）
 * 每档各测 3 轮，比较中位数。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $$ = (s) => [...document.querySelectorAll(s)]
const $ = (s) => document.querySelector(s)
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)

window.location.hash = '#/search'
await sleep(700)
const search = store('search')
const res = await window.api.search.search({ keyword: '周杰伦', limit: 200 })
const seen = new Set()
const merged = []
for (const g of res.platforms ?? []) for (const s of g.songs ?? []) { if (!seen.has(s.id)) { seen.add(s.id); merged.push(s) } }
search.activePlatform = 'all'
search.platforms = [{ platform: 'kw', providerName: 'interleave', songs: merged.slice(0, 140), error: null }]
for (let i = 0; i < 200; i += 1) { if ($$('.results .row').length === 140) break; await sleep(40) }
await sleep(600)

const body = $('.results .body')
async function pass() {
  body.scrollTop = 0
  await sleep(200)
  const frames = []
  let last = performance.now()
  let steps = 0
  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now()
      frames.push(Number((now - last).toFixed(2)))
      last = now
      steps += 1
      const before = body.scrollTop
      body.scrollTop = Math.min(before + body.clientHeight * 0.8, body.scrollHeight)
      if (steps >= 60 || body.scrollTop === before) return resolve()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await sleep(150)
  const s = [...frames].sort((a, b) => a - b)
  return {
    avg: Number((frames.reduce((x, y) => x + y, 0) / frames.length).toFixed(2)),
    p95: s[Math.floor(s.length * 0.95)],
    max: s[s.length - 1]
  }
}

// 关掉伪元素的开关样式：先创建但 disabled，测量时启用
const kill = document.createElement('style')
kill.textContent = '.results .row::before, .results .row::after { content: none !important; }'
kill.disabled = true
document.head.appendChild(kill)

const runs = { A: [], B: [] }
await pass() // 预热
for (let i = 0; i < 3; i += 1) {
  kill.disabled = false
  await sleep(250)
  runs.B.push(await pass()) // B = 无伪元素
  kill.disabled = true
  await sleep(250)
  runs.A.push(await pass()) // A = 现状
}
kill.remove()

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
return {
  A_现状: { runs: runs.A, medianAvg: median(runs.A.map((r) => r.avg)), medianP95: median(runs.A.map((r) => r.p95)) },
  B_无伪元素: { runs: runs.B, medianAvg: median(runs.B.map((r) => r.avg)), medianP95: median(runs.B.map((r) => r.p95)) },
  deltaAvgMs: Number((median(runs.A.map((r) => r.avg)) - median(runs.B.map((r) => r.avg))).toFixed(2)),
  rows: $$('.results .row').length
}
