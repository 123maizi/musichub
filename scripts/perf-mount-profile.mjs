/**
 * 挂载时间线剖析（隔离网络版）。
 *
 * 先把结果搜出来存进 store，再离开搜索页让 SongTable 卸载，然后回到搜索页 ——
 * 此时 140 行是**从零创建 DOM**（key 全不同、无缓存），但不含任何网络耗时。
 * 这样量到的就是纯渲染路径：一次创建 vs 分批创建。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const search = store('search')

/* 1. 备好数据 */
window.location.hash = '#/search'
await sleep(700)
if (search.activePlatform !== 'all') {
  $$('.tabs .tab').find((b) => b.innerText.includes('全部'))?.click()
  await sleep(400)
}
if (search.visibleSongs.length === 0) {
  const input = $('.search-box input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '周杰伦')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(150)
  $$('.search-box button').find((b) => b.innerText.includes('搜索'))?.click()
  for (let i = 0; i < 200; i += 1) {
    await sleep(100)
    if ($$('.results .row').length > 0 && $$('.results .row').length === search.visibleSongs.length) break
  }
}
const total = search.visibleSongs.length

/* 2. 卸载 → 回来自动重挂（无网络） */
window.location.hash = '#/library'
await sleep(800)
if ($$('.results .row').length !== 0) return { error: '离开搜索页后 SongTable 没卸载' }

const timeline = []
const longTasks = []
const po = new PerformanceObserver((l) => {
  for (const e of l.getEntries()) longTasks.push({ start: Number(e.startTime.toFixed(1)), dur: Number(e.duration.toFixed(1)) })
})
po.observe({ entryTypes: ['longtask'] })

const obs = new MutationObserver(() => {
  const n = $$('.results .row').length
  if (n !== (timeline[timeline.length - 1]?.n ?? -1)) timeline.push({ t: Number(performance.now().toFixed(1)), n })
})

// 观察节点先挂在 body 上（此时 .results 还不存在）
obs.observe(document.body, { childList: true, subtree: true })
const t0 = performance.now()
window.location.hash = '#/search'
const first = performance.now() - t0

for (let i = 0; i < 200; i += 1) {
  await sleep(50)
  const n = $$('.results .row').length
  if (n > 0 && n === search.visibleSongs.length) break
}
await sleep(500)
obs.disconnect()
po.disconnect()

const t0abs = t0
return {
  total,
  hashSwitchCostMs: Number(first.toFixed(1)),
  finalRows: $$('.results .row').length,
  rowTimeline: timeline.map((r) => ({ atMs: Number((r.t - t0abs).toFixed(1)), rows: r.n })),
  longTasks: longTasks
    .filter((t) => t.start >= t0abs - 30)
    .map((t) => ({ atMs: Number((t.start - t0abs).toFixed(1)), durMs: t.dur, rowsBefore: timeline.filter((r) => r.t <= t.start).pop()?.n ?? 0 }))
}
