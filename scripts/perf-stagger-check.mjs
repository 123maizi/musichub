/**
 * 实测入场动效总时长（Lead 要求 ≤700ms）+ 入场窗口帧采样。
 * 依据：motion.css 的 .stagger-in 是前 12 个、34ms 错峰、--dur-2(360ms)；
 * SongTable 里把错峰压到 24ms → 24×11 + 360 = 624ms。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $$ = (s) => [...document.querySelectorAll(s)]
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const out = {}

window.location.hash = '#/search'
await sleep(700)
const search = store('search')
const res = await window.api.search.search({ keyword: '周杰伦', limit: 200 })
const seen = new Set()
const merged = []
for (const g of res.platforms ?? []) for (const s of g.songs ?? []) { if (!seen.has(s.id)) { seen.add(s.id); merged.push(s) } }
search.activePlatform = 'all'

// 离开再回来，触发一次干净的行入场
window.location.hash = '#/library'
await sleep(700)
const t0 = performance.now()
search.platforms = [{ platform: 'kw', providerName: 'anim', songs: merged.slice(0, 140), error: null }]
window.location.hash = '#/search'

// 等前 12 行出现后读它们身上的动画
let first12 = []
for (let i = 0; i < 100; i += 1) {
  first12 = $$('.results .row').slice(0, 12)
  if (first12.length >= 12) break
  await sleep(20)
}
const anims = []
for (const [i, row] of first12.entries()) {
  for (const a of row.getAnimations()) {
    const timing = a.effect?.getComputedTiming?.() ?? {}
    anims.push({
      index: i + 1,
      name: a.animationName ?? null,
      delayMs: Math.round(timing.delay ?? 0),
      durationMs: Math.round(timing.duration ?? 0),
      endMs: Math.round((timing.delay ?? 0) + (timing.duration ?? 0)),
      animatedProps: (a.effect?.getKeyframes?.() ?? []).flatMap((k) => Object.keys(k)).filter((k) => !k.startsWith('offset') && k !== 'easing' && k !== 'composite')
    })
  }
}
out.stagger = {
  rowsWithAnimation: new Set(anims.map((a) => a.index)).size,
  maxEndMs: anims.length ? Math.max(...anims.map((a) => a.endMs)) : null,
  delays: anims.map((a) => a.delayMs),
  durations: [...new Set(anims.map((a) => a.durationMs))],
  animatedProps: [...new Set(anims.flatMap((a) => a.animatedProps))],
  rowsBeyond12Animated: $$('.results .row').slice(12).filter((r) => r.getAnimations().length > 0).length
}
out.stagger.under700 = out.stagger.maxEndMs !== null && out.stagger.maxEndMs <= 700

// 入场窗口帧采样（挂载起 900ms）
const frames = []
let last = performance.now()
await new Promise((resolve) => {
  const tick = () => {
    const now = performance.now()
    frames.push(Number((now - last).toFixed(2)))
    last = now
    if (now - t0 >= 900) return resolve()
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
const sorted = [...frames].sort((a, b) => a - b)
out.entryWindow = {
  frames: frames.length,
  avgFrameMs: Number((frames.reduce((s, x) => s + x, 0) / frames.length).toFixed(2)),
  p95: sorted[Math.floor(sorted.length * 0.95)],
  max: sorted[sorted.length - 1],
  over33: frames.filter((x) => x > 33.4).length,
  over50: frames.filter((x) => x > 50).length
}
out.rows = $$('.results .row').length
return out
