/**
 * task-11 验收探针：搜索页空态 = 歌曲列表（历史 / 喜欢 / 歌单，可配置）
 *
 * 断言：
 *   1. 空态时 .results .row === 0，但推荐区 .recommend .row > 0（页面真的被用起来了）
 *   2. 三种来源各自：标题文本正确、行数与对应 store 一致（截断到 24 上限）
 *   3. 来源为空时：出现引导文案 + 切换入口（不留白）
 *   4. 有搜索结果时：推荐区不渲染、.results .row > 0（正常路径行为不变）
 *   5. 行数上限：来源总数 > 24 时只渲染 24 行
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $$ = (s) => [...document.querySelectorAll(s)]
const $ = (s) => document.querySelector(s)
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const out = { checks: {} }
const check = (name, pass, evidence) => {
  out.checks[name] = { pass: !!pass, evidence }
}

const search = store('search')
const library = store('library')
const EMPTY_LIMIT = 24

/** 回到「还没搜」的干净空态 */
async function gotoCleanEmpty() {
  window.location.hash = '#/search'
  for (let i = 0; i < 100; i += 1) {
    if ($('.search-box input')) break
    await sleep(80)
  }
  search.keyword = ''
  search.platforms = []
  search.error = null
  search.activePlatform = 'all'
  await sleep(500)
}

/** 读当前空态面板的状态 */
function readPanel() {
  const panel = $('.recommend')
  return {
    panelPresent: !!panel,
    title: $('.recommend-title')?.innerText?.trim() ?? null,
    hint: panel?.querySelector('.recommend-titles .small-text')?.innerText?.replace(/\s+/g, ' ').trim() ?? null,
    panelRows: $$('.recommend .row').length,
    resultRows: $$('.results .row').length,
    sourceButtons: $$('.source-switch button').map((b) => ({
      label: b.innerText.trim(),
      active: b.classList.contains('active')
    })),
    emptyFallback: $('.recommend-empty')?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 60) ?? null
  }
}

async function setSource(src) {
  const btn = $$('.source-switch button').find((b) => {
    const label = b.innerText.trim()
    return (
      (src === 'history' && label.includes('历史')) ||
      (src === 'favorites' && label.includes('喜欢')) ||
      (src === 'playlist' && label.includes('歌单'))
    )
  })
  btn?.click()
  // 偏好写入是 IPC + 防抖，等状态落定
  for (let i = 0; i < 40; i += 1) {
    if (search.emptySource === src) break
    await sleep(60)
  }
  await sleep(350)
}

/* ---------- 0. 准备：确保三个来源里至少有数据可验 ---------- */
await gotoCleanEmpty()
// 历史：如果为空，先播一首造一条记录（用搜索结果里第一首）
if (library.history.length === 0) {
  const res = await window.api.search.search({ keyword: '周杰伦', limit: 5 })
  const first = res.platforms?.find((p) => p.songs?.length)?.songs?.[0]
  if (first) {
    await window.api.library.recordPlay(JSON.parse(JSON.stringify(first)))
    await library.refresh()
  }
}
out.dataAvailable = {
  history: library.history.length,
  favorites: library.favorites.length,
  playlists: library.playlists.length
}

/* ---------- 1. 历史来源（默认） ---------- */
await setSource('history')
const historyPanel = readPanel()
const historyExpected = Math.min(library.history.length, EMPTY_LIMIT)
check('空态：.results .row=0 且推荐区行数>0', historyPanel.resultRows === 0 && historyPanel.panelRows > 0, {
  resultRows: historyPanel.resultRows,
  panelRows: historyPanel.panelRows
})
check('历史来源：标题 + 行数 + 与 store 一致', historyPanel.title === '继续听' && historyPanel.panelRows === historyExpected, {
  title: historyPanel.title,
  panelRows: historyPanel.panelRows,
  storeHistory: library.history.length,
  expected: historyExpected
})
out.history = historyPanel

/* ---------- 2. 喜欢来源 ---------- */
if (library.favorites.length === 0) {
  // 造一条收藏（用历史里第一首，避免依赖搜索）
  const song = library.history[0]?.song
  if (song) {
    await window.api.library.toggleFavorite(JSON.parse(JSON.stringify(song)))
    await library.refresh()
  }
}
await setSource('favorites')
const favPanel = readPanel()
const favExpected = Math.min(library.favorites.length, EMPTY_LIMIT)
check('喜欢来源：标题 + 行数 + 与 store 一致', favPanel.title === '我喜欢的' && favPanel.panelRows === favExpected, {
  title: favPanel.title,
  panelRows: favPanel.panelRows,
  storeFavorites: library.favorites.length,
  expected: favExpected
})
out.favorites = favPanel

/* ---------- 3. 歌单来源 ---------- */
if (library.playlists.length === 0) {
  await window.api.library.playlist({ type: 'create', name: 'perf 空态校验歌单' })
  await library.refresh()
  const created = library.playlists[library.playlists.length - 1]
  const songs = library.history.slice(0, 3).map((h) => h.song)
  if (created && songs.length > 0) {
    await window.api.library.playlist({
      type: 'addSongs',
      id: created.id,
      songs: songs.map((s) => JSON.parse(JSON.stringify(s)))
    })
    await library.refresh()
  }
}
await setSource('playlist')
const plPanel = readPanel()
const plFirst = library.playlists[0]
const plDedup = plFirst ? new Set(plFirst.songs.map((s) => s.id)).size : 0
const plExpected = Math.min(plDedup, EMPTY_LIMIT)
check('歌单来源：标题 + 行数 + 与 store 一致', plPanel.title === '歌单里的歌' && plPanel.panelRows === plExpected, {
  title: plPanel.title,
  panelRows: plPanel.panelRows,
  storePlaylistSongs: plDedup,
  playlistName: plFirst?.name ?? null,
  expected: plExpected
})
out.playlist = plPanel

/* ---------- 4. 行数上限（硬验：灌 40 首进「我的喜欢」，看是否只渲染 24 行 + 且无长任务） ---------- */
const bulkRes = await window.api.search.search({ keyword: '周杰伦', limit: 200 })
const bulkSeen = new Set()
const bulkSongs = []
for (const g of bulkRes.platforms ?? []) {
  for (const s of g.songs ?? []) {
    if (bulkSeen.has(s.id)) continue
    bulkSeen.add(s.id)
    bulkSongs.push(JSON.parse(JSON.stringify(s)))
  }
}
const bulk = bulkSongs.slice(0, 40)
const before = new Set(library.favorites.map((s) => s.id))
for (const song of bulk) {
  if (!before.has(song.id)) await window.api.library.toggleFavorite(song)
}
await library.refresh()

// 切到喜欢来源，同时观察这次挂载有没有长任务
const longTasks = []
const po = new PerformanceObserver((l) => {
  for (const e of l.getEntries()) longTasks.push(Math.round(e.duration))
})
try {
  po.observe({ entryTypes: ['longtask'] })
} catch {
  /* 不支持就跳过 */
}
await setSource('favorites')
await sleep(700)
po.disconnect()

const capped = readPanel()
check('行数上限：来源 40 首时只渲染 24 行', capped.panelRows === EMPTY_LIMIT, {
  panelRows: capped.panelRows,
  storeFavorites: library.favorites.length,
  limit: EMPTY_LIMIT,
  hint: capped.hint
})
check('空态面板挂载无长任务', longTasks.length === 0, { longTasks })

// 还原：把我刚灌进去的收藏撤掉
for (const song of bulk) {
  if (!before.has(song.id)) await window.api.library.toggleFavorite(song)
}
await library.refresh()

/* ---------- 5. 来源为空时的引导 ---------- */
// 临时把「喜欢」清空来验证兜底（本机为私有测试 profile）
const favBackup = library.favorites.map((s) => JSON.parse(JSON.stringify(s)))
if (library.favorites.length > 0) {
  for (const song of favBackup) {
    await window.api.library.toggleFavorite(song)
  }
  await library.refresh()
}
await setSource('favorites')
const emptyPanel = readPanel()
check('来源为空：引导文案 + 切换入口，不留白', !!emptyPanel.emptyFallback && emptyPanel.sourceButtons.length === 3, {
  fallbackText: emptyPanel.emptyFallback,
  sourceButtons: emptyPanel.sourceButtons.map((b) => b.label),
  panelRows: emptyPanel.panelRows
})
// 还原收藏
for (const song of favBackup) await window.api.library.toggleFavorite(song)
await library.refresh()

/* ---------- 6. 有搜索结果时：正常路径不变 ---------- */
await setSource('history')
const res = await window.api.search.search({ keyword: '周杰伦', limit: 40 })
const seen = new Set()
const merged = []
for (const g of res.platforms ?? []) for (const s of g.songs ?? []) { if (!seen.has(s.id)) { seen.add(s.id); merged.push(s) } }
search.activePlatform = 'all'
search.keyword = '周杰伦'
search.platforms = [{ platform: 'kw', providerName: 'verify', songs: merged, error: null }]
for (let i = 0; i < 120; i += 1) { if ($$('.results .row').length > 0) break; await sleep(80) }
await sleep(400)
const withResults = readPanel()
check('有结果时：推荐区不渲染、.results .row>0', !withResults.panelPresent && withResults.resultRows > 0, {
  panelPresent: withResults.panelPresent,
  resultRows: withResults.resultRows
})

out.summary = {
  total: Object.keys(out.checks).length,
  passed: Object.values(out.checks).filter((c) => c.pass).length,
  failed: Object.keys(out.checks).filter((k) => !out.checks[k].pass)
}
return out
