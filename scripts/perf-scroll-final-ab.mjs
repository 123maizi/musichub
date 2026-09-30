/**
 * 覆盖层 vs 静态底 的最终对照：
 *  A 现状（伪元素覆盖层 + .table isolation）
 *  B 行级层叠上下文（position+z-index）覆盖层
 *  C 无伪元素：静态 background + inset 刻线（本实验要验证的候选）
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
search.platforms = [{ platform: 'kw', providerName: 'final', songs: merged.slice(0, 140), error: null }]
for (let i = 0; i < 200; i += 1) { if ($$('.results .row').length === 140) break; await sleep(40) }
await sleep(500)

const body = $('.results .body')
const stats = (f) => {
  const s = [...f].sort((a, b) => a - b)
  return {
    avg: Number((f.reduce((x, y) => x + y, 0) / f.length).toFixed(2)),
    p50: s[Math.floor(s.length * 0.5)],
    p95: s[Math.floor(s.length * 0.95)],
    max: s[s.length - 1],
    over33: f.filter((x) => x > 33.4).length
  }
}
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
  await sleep(160)
  return frames
}
async function measure(css) {
  let el = null
  if (css) {
    el = document.createElement('style')
    el.textContent = css
    document.head.appendChild(el)
  }
  await sleep(300)
  await pass()
  const frames = []
  for (let i = 0; i < 3; i += 1) frames.push(...(await pass()))
  if (el) el.remove()
  await sleep(300)
  return stats(frames)
}

const killPseudos = `.results .row::before, .results .row::after { content: none !important; }`

const out = {}
out.A_现状_覆盖层_table_isolation = await measure(null)
out.B_覆盖层_行级层叠 = await measure(
  `.results .table { isolation: auto !important; position: static !important; } .results .row { position: relative !important; z-index: 0 !important; }`
)
out.C_静态底加inset刻线_无伪元素 = await measure(
  `${killPseudos}
   .results .table { isolation: auto !important; position: static !important; }
   .results .row { z-index: auto !important; }
   .results .row:hover { background-color: var(--surface-3) !important; }
   .results .row.playing, .results .row.selected {
     background-color: color-mix(in srgb, var(--accent) 7%, transparent) !important;
     box-shadow: inset 2px 0 0 0 var(--accent) !important;
   }`
)
out.D_完全回到最小_无任何行态样式 = await measure(
  `${killPseudos}
   .results .table { isolation: auto !important; position: static !important; }
   .results .row { z-index: auto !important; }`
)
return out
