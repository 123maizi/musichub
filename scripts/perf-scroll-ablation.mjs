/**
 * 滚动回退归因（消融实验）：逐个关掉本轮新增的样式，看哪个才是 +1.3ms 的来源。
 * 场景：140 行钉死，滚 13 屏，每档测 3 遍取合并帧样本。
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
search.platforms = [{ platform: 'kw', providerName: 'ablate', songs: merged.slice(0, 140), error: null }]
for (let i = 0; i < 200; i += 1) { if ($$('.results .row').length === 140) break; await sleep(40) }
await sleep(500)

const body = $('.results .body')
const stats = (frames) => {
  const sorted = [...frames].sort((a, b) => a - b)
  const sum = frames.reduce((s, x) => s + x, 0)
  return {
    frames: frames.length,
    avg: Number((sum / frames.length).toFixed(2)),
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted[sorted.length - 1],
    over33: frames.filter((x) => x > 33.4).length
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
async function measure(label, css) {
  let el = null
  if (css) {
    el = document.createElement('style')
    el.textContent = css
    document.head.appendChild(el)
  }
  await sleep(300)
  // 预热一遍再测 3 遍
  await pass()
  const frames = []
  for (let i = 0; i < 3; i += 1) frames.push(...(await pass()))
  if (el) el.remove()
  await sleep(300)
  return { label, ...stats(frames) }
}

const out = {}
out['0-现状'] = await measure('0-现状', null)
out['1-关掉行的两层伪元素'] = await measure('1-关掉行的两层伪元素', '.results .row::before, .results .row::after { content: none !important; }')
out['2-再关掉行的 z-index/position'] = await measure(
  '2-再关掉行的 z-index/position',
  '.results .row::before, .results .row::after { content: none !important; } .results .row { position: static !important; z-index: auto !important; }'
)
out['3-关掉行内按钮的 24px 命中区'] = await measure(
  '3-关掉行内按钮的 24px 命中区',
  '.results .row .tiny { min-width: 0 !important; min-height: 0 !important; padding: 4px 7px !important; }'
)
out['4-关掉视图根的路由过渡'] = await measure(
  '4-关掉视图根的路由过渡',
  '.page > * { transition: none !important; animation: none !important; }'
)
out['5-关掉全部 .clickable 颜色过渡'] = await measure('5-关掉全部 .clickable 颜色过渡', '.results .clickable { transition: none !important; }')
return { rows: $$('.results .row').length, domNodes: document.getElementsByTagName('*').length, results: out }
