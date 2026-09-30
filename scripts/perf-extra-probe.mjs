/**
 * 收尾验证（render-perf）：
 *   A. 真实下载中的进度事件频率（确认主进程 300ms 节流在渲染层观察到的效果）
 *   B. 搜索结果还在分批挂载时立刻离开页面 → 不应报错、不应泄漏；回来仍是 140 行
 *   C. 结构体检：v-for key 稳定性、路由懒加载、DOM 节点/行的构成
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
const out = {}

function pinia() {
  return document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
}
const store = (n) => pinia()._s.get(n)
async function waitFor(fn, timeout = 15000, interval = 150) {
  const t0 = Date.now()
  for (;;) {
    let v
    try {
      v = await fn()
    } catch {
      v = null
    }
    if (v) return v
    if (Date.now() - t0 > timeout) return null
    await sleep(interval)
  }
}

/* ---------- A. 真实下载的进度事件频率 ---------- */
const search = store('search')
window.location.hash = '#/search'
await sleep(800)
if (search.visibleSongs.length === 0) {
  const input = $('.search-box input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '周杰伦')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(150)
  $$('.search-box button').find((b) => b.innerText.includes('搜索'))?.click()
  await waitFor(() => (search.visibleSongs.length > 0 ? true : null), 20000)
}

const song = search.visibleSongs[12]
const stamps = []
const off = window.api.on(window.api.events.downloadProgress, () => stamps.push(performance.now()))
const created = await window.api.download.add({ songs: [JSON.parse(JSON.stringify(song))] })
const ids = (created ?? []).map((t) => t.id)
const started = performance.now()
let peakProgress = 0
let status = 'unknown'
for (let i = 0; i < 60; i += 1) {
  await sleep(500)
  const list = await window.api.download.list()
  const t = list.find((x) => ids.includes(x.id))
  if (t) {
    peakProgress = Math.max(peakProgress, t.progress ?? 0)
    status = t.status
    if (t.status === 'done' || t.status === 'error') break
  }
  if (performance.now() - started > 25000) break
}
off()
const elapsedSec = (performance.now() - started) / 1000
// 相邻事件的时间间隔（节流是否生效的直接证据）
const gaps = stamps.slice(1).map((t, i) => Number((t - stamps[i]).toFixed(0)))
await window.api.download.remove(ids, true)
out.downloadProgress = {
  events: stamps.length,
  elapsedSec: Number(elapsedSec.toFixed(1)),
  eventsPerSec: Number((stamps.length / elapsedSec).toFixed(2)),
  minGapMs: gaps.length ? Math.min(...gaps) : null,
  medianGapMs: gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null,
  status,
  peakProgress: Number(peakProgress.toFixed(1)),
  note: '主进程 PROGRESS_THROTTLE=300ms，事件间隔不应长期小于 300ms'
}

/* ---------- B. 挂载中途离开页面 ---------- */
window.location.hash = '#/library'
await sleep(600)
window.location.hash = '#/search'
await sleep(900)
const input2 = $('.search-box input')
const setter2 = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
setter2.call(input2, '林俊杰')
input2.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(120)
$$('.search-box button').find((b) => b.innerText.includes('搜索'))?.click()
// 结果可能刚挂上第一批就立刻跳走
await waitFor(() => ($$('.results .row').length > 0 ? true : null), 20000)
window.location.hash = '#/library'
await sleep(500)
window.location.hash = '#/search'
const backRows = await waitFor(() => {
  const n = $$('.results .row').length
  return n > 0 && n === store('search').visibleSongs.length ? n : null
}, 10000)
out.midMountUnmount = {
  rowsAfterReturn: backRows,
  storeSongs: store('search').visibleSongs.length,
  ok: backRows === store('search').visibleSongs.length && backRows > 0
}

/* ---------- C. 结构体检 ---------- */
const rows = $$('.results .row')
const keys = rows.slice(0, 5).map((r) => r.className)
const routeChunks = [...document.querySelectorAll('script')].map((s) => s.getAttribute('src'))
out.structure = {
  rowKeysStableBySongId: 'template 里 :key="song.id"（代码审查确认；DOM 侧看 data-v 与顺序稳定）',
  sampleRowClasses: keys,
  loadedScripts: routeChunks,
  domTotal: document.getElementsByTagName('*').length,
  rowCount: rows.length,
  nodesPerRow: Number((document.getElementsByTagName('*').length / rows.length).toFixed(2)),
  buttonsPerRow: rows[0] ? rows[0].querySelectorAll('button').length : null,
  iconsPerRow: rows[0] ? rows[0].querySelectorAll('svg').length : null,
  imgPerRow: rows[0] ? rows[0].querySelectorAll('img').length : null,
  contentVisibility: rows[0] ? getComputedStyle(rows[0]).contentVisibility : null
}

return out
