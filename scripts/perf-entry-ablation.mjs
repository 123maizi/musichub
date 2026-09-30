/**
 * 入场窗口 >33ms 帧的归因（交错 A/B）：
 *   A = 现状（stagger 前 12 行、24ms 错峰、--dur-2）
 *   B = 关掉 .stagger-in 的动画
 * 看掉帧是动效造成的，还是封面解码/挂载造成的。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $$ = (s) => [...document.querySelectorAll(s)]
const $ = (s) => document.querySelector(s)
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)

window.location.hash = '#/search'
for (let i = 0; i < 100; i += 1) { if ($('.search-box input')) break; await sleep(80) }
const search = store('search')
const res = await window.api.search.search({ keyword: '周杰伦', limit: 200 })
const seen = new Set()
const merged = []
for (const g of res.platforms ?? []) for (const s of g.songs ?? []) { if (!seen.has(s.id)) { seen.add(s.id); merged.push(s) } }
search.activePlatform = 'all'

const kill = document.createElement('style')
kill.textContent = '.results .body.stagger-in > * { animation: none !important; }'
kill.disabled = true
document.head.appendChild(kill)

function sample(durationMs) {
  const frames = []
  const t0 = performance.now()
  let last = t0
  return new Promise((resolve) => {
    const tick = () => {
      const now = performance.now()
      frames.push(Number((now - last).toFixed(2)))
      last = now
      if (now - t0 >= durationMs) {
        const sorted = [...frames].sort((a, b) => a - b)
        resolve({
          frames: frames.length,
          avg: Number((frames.reduce((s, x) => s + x, 0) / frames.length).toFixed(2)),
          p95: sorted[Math.floor(sorted.length * 0.95)],
          max: sorted[sorted.length - 1],
          over33: frames.filter((x) => x > 33.4).length
        })
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

async function run(withStagger) {
  window.location.hash = '#/library'
  await sleep(600)
  kill.disabled = withStagger
  const framesP = sample(900)
  search.platforms = [{ platform: 'kw', providerName: 'entry', songs: merged.slice(0, 140), error: null }]
  window.location.hash = '#/search'
  const r = await framesP
  for (let i = 0; i < 100; i += 1) { if ($$('.results .row').length === 140) break; await sleep(40) }
  await sleep(300)
  return r
}

const runs = { withStagger: [], without: [] }
await run(true) // 预热
for (let i = 0; i < 3; i += 1) {
  runs.withStagger.push(await run(true))
  runs.without.push(await run(false))
}
kill.remove()
const med = (arr, k) => [...arr.map((r) => r[k])].sort((a, b) => a - b)[1]
return {
  withStagger: { runs: runs.withStagger, medianOver33: med(runs.withStagger, 'over33'), medianAvg: med(runs.withStagger, 'avg') },
  withoutStagger: { runs: runs.without, medianOver33: med(runs.without, 'over33'), medianAvg: med(runs.without, 'avg') },
  verdict:
    med(runs.withStagger, 'over33') > med(runs.without, 'over33')
      ? '掉帧主要由入场动效带来'
      : '掉帧与入场动效无关（封面解码/挂载为主）'
}
