/**
 * 渲染层功能回归 + 性能相关行为验证（render-perf 专用，CDP 9225）。
 *
 * 覆盖用户点名的全部能力，一项都不能少：
 *   长列表完整性 / 当前播放行高亮 / 多选 / 批量下载 / 收藏 / 加入队列 /
 *   双击播放 / 专辑跳转 / 艺人跳转 / 歌单（新建·加入·查看·移出·重命名·删除）
 * 另外验证：
 *   - 渐进式渲染最终会把 140 行全部挂上（不是虚拟滚动）
 *   - 反复进出页面不会泄漏（堆内存与 DOM 行数）
 *   - 下载进度事件频率（IPC 节流是否够）
 *
 * 用 node scripts/perf-cdp.mjs evalfile scripts/perf-regression.mjs 跑。
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
const out = { checks: {}, notes: [] }

function check(name, pass, evidence) {
  out.checks[name] = { pass: !!pass, evidence }
  return !!pass
}

/** 从 DOM 上的 Vue 应用实例拿到 pinia，进而读 store —— 用来核对真实状态而不是只看界面 */
function pinia() {
  const app = document.querySelector('#app').__vue_app__
  return app.config.globalProperties.$pinia
}
const store = (name) => pinia()._s.get(name)

async function waitFor(label, fn, timeout = 12000, interval = 120) {
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

/* ------------------------------ 0. 下载目录改到临时目录 ------------------------------ */
try {
  const cfg = await window.api.download.setConfig({ dir: 'F:\\MusicHub\\.tmp\\perf-downloads' })
  out.downloadDir = cfg?.dir ?? null
} catch (err) {
  out.downloadDir = `设置失败: ${err?.message ?? err}`
}

/* ------------------------------ 1. 搜索 140 行 ------------------------------ */
window.location.hash = '#/search'
await sleep(700)
const input = $('.search-box input')
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
setter.call(input, '周杰伦')
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(150)
$$('.search-box button').find((b) => b.innerText.includes('搜索'))?.click()

const searchStore = store('search')
await waitFor('首行出现', () => ($$('.results .row').length > 0 ? true : null), 20000)
// 渐进式渲染：等它把剩下的补齐（不是虚拟滚动，最终必须全在 DOM 里）
await waitFor(
  '全部行补齐',
  () => ($$('.results .row').length === searchStore.visibleSongs.length ? true : null),
  8000
)
const finalRows = $$('.results .row').length
// 行数随上游返回浮动（QQ/网易被限流时会变少），判据是
// 「DOM 行数 == store 行数 且非空」，而不是死磕 140 ——
// 这一条验的是渐进式渲染最终会把每一行都真实挂上。
check('长列表全部行真实挂载（DOM 行数 == store 行数）', finalRows > 0 && searchStore.visibleSongs.length === finalRows, {
  finalRows,
  storeSongs: searchStore.visibleSongs.length
})

/* ------------------------------ 2. 加入播放队列（先测，此时队列为空） ------------------------------ */
const playerStore = store('player')
const queueSong = searchStore.visibleSongs[6]
// 若这首歌已在队列里（比如上一轮测试播过整张表），先摘掉 ——
// addToQueue 对同一首是去重的，不去掉会让「+1」断言失真
if (playerStore.playlist.some((s) => s.id === queueSong.id)) playerStore.removeFromQueue(queueSong.id)
const queueBefore = playerStore.playlist.length
$$('.results .row')[6].querySelector('button[title="加入播放队列"]')?.click()
await sleep(400)
const queue = playerStore.playlist
check('加入播放队列', queue.length === queueBefore + 1 && queue[queue.length - 1]?.id === queueSong.id, {
  before: queueBefore,
  after: queue.length,
  lastId: queue[queue.length - 1]?.id ?? null,
  expectedId: queueSong.id
})

/* ------------------------------ 3. 双击播放 + 当前行高亮 ------------------------------ */
const song0 = searchStore.visibleSongs[0]
const row0 = $$('.results .row')[0]
row0.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
// 播放器用的是游离的 Audio 实例（不在 DOM 里），只能读 store 状态
const playing = await waitFor(
  '开始出声',
  () => (playerStore.current?.id === song0.id && playerStore.playing && playerStore.progress > 0 ? playerStore.progress : null),
  25000
)
const highlighted = await waitFor('高亮行出现', () => ($$('.results .row.playing').length > 0 ? $$('.results .row.playing').length : null), 8000)
const highlightedIdx = $$('.results .row').findIndex((r) => r.classList.contains('playing'))
check('双击播放', playing !== null && playerStore.error == null, {
  progress: playing !== null ? Number(playing.toFixed(1)) : null,
  playing: playerStore.playing,
  current: playerStore.current?.name ?? null,
  error: playerStore.error ?? null
})
check('当前播放行高亮', highlighted === 1 && highlightedIdx === 0 && playerStore.current?.id === song0.id, {
  highlightedRows: highlighted,
  highlightedIdx,
  currentId: playerStore.current?.id ?? null,
  expectedId: song0.id
})

/* ------------------------------ 4. 多选 ------------------------------ */
$$('.meta-row button').find((b) => b.innerText.includes('多选'))?.click()
await sleep(400)
const boxes = $$('.results .row .row-check')
check('多选模式给每一行都渲染出复选框', boxes.length > 0 && boxes.length === searchStore.visibleSongs.length, {
  boxes: boxes.length,
  storeSongs: searchStore.visibleSongs.length
})

// 每次点击间隔 250ms —— 真人点击必然是不同任务，这是真实时序
boxes[1].click()
await sleep(250)
boxes[2].click()
await sleep(250)
boxes[3].click()
await sleep(400)
const selectedText = $$('.meta-row .small-text').map((s) => s.innerText.trim()).find((t) => t.includes('已选')) ?? null
const checkedInDom = $$('.results .row .row-check:checked').length
check('勾选 3 首生效', /已选\s*3\s*首/.test(selectedText ?? '') && checkedInDom === 3, {
  selectedText,
  checkedInDom
})

/* ------------------------------ 4. 批量下载 ------------------------------ */
const beforeTasks = (await window.api.download.list()).length
$$('.meta-row button').find((b) => b.innerText.includes('下载所选'))?.click()
const bulkToast = await waitFor('批量下载回执', () => {
  const t = $('.toast')?.innerText?.trim() ?? ''
  return t.includes('加入下载队列') ? t : null
}, 10000)
const afterTasks = (await window.api.download.list()).length
check('批量下载 3 首', afterTasks - beforeTasks === 3, { beforeTasks, afterTasks, toast: bulkToast })

// 清掉刚才的下载任务，别在磁盘上留东西
const created = (await window.api.download.list()).slice(0, 3).map((t) => t.id)
await window.api.download.remove(created, true)

/* ------------------------------ 5. 收藏 ------------------------------ */
const libraryStore = store('library')
const favSong = searchStore.visibleSongs[5]
const favBtn = () => $$('.results .row')[5].querySelector('button[title*="收藏"]')
const favBefore = libraryStore.isFavorite(favSong.id)
favBtn().click()
const favAfterOn = await waitFor('收藏生效', () => (libraryStore.isFavorite(favSong.id) ? true : null), 8000)
favBtn().click()
const favAfterOff = await waitFor('取消收藏生效', () => (!libraryStore.isFavorite(favSong.id) ? true : null), 8000)
await sleep(200)
const heartTitle = favBtn()?.getAttribute('title') ?? null
check('收藏 / 取消收藏', favBefore === false && favAfterOn === true && favAfterOff === true, {
  before: favBefore,
  afterOn: favAfterOn,
  afterOff: favAfterOff,
  buttonTitle: heartTitle
})

/* ------------------------------ 8. 加入歌单（列表内行内按钮） ------------------------------ */
const plBefore = (await window.api.library.snapshot()).playlists.length
$$('.results .row')[7].querySelector('button[title*="加入歌单"]')?.click()
const menuOpen = await waitFor('歌单面板打开', () => ($('.panel[aria-label="加入歌单"]') ? true : null), 5000)
const menuInput = $('.panel input')
if (menuInput) {
  setter.call(menuInput, 'render-perf 回归歌单')
  menuInput.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(120)
  $$('.panel .new button').find((b) => b.innerText.includes('创建'))?.click()
}
// 等「歌单已建好」且「歌已经进去」—— 新建与加入是两次 IPC，要等最终态
const plAfterSnapshot = await waitFor(
  '歌单创建且加入成功',
  async () => {
    const snap = await window.api.library.snapshot()
    const pl = snap.playlists.find((p) => p.name === 'render-perf 回归歌单')
    return pl && pl.songs.length >= 1 ? snap : null
  },
  12000
)
const createdPlaylist = plAfterSnapshot?.playlists?.find((p) => p.name === 'render-perf 回归歌单') ?? null
check('行内「加入歌单」新建并加入', !!createdPlaylist && createdPlaylist.songs.length === 1, {
  menuOpen,
  playlistsBefore: plBefore,
  playlistsAfter: plAfterSnapshot?.playlists?.length ?? null,
  createdSongs: createdPlaylist?.songs?.length ?? null
})

/* ------------------------------ 8. 专辑跳转 ------------------------------ */
// 关掉弹层，避免挡住点击
$('.backdrop')?.click()
await sleep(400)
const albumRowIdx = searchStore.visibleSongs.findIndex((s) => s.albumName && s.albumName.trim())
$$('.results .row')[albumRowIdx].querySelector('.col-album')?.click()
const albumHash = await waitFor('跳到专辑页', () => (location.hash.startsWith('#/album') ? location.hash : null), 8000)
const albumRows = await waitFor('专辑页有曲目', () => ($$('.results .row, .songs .row').length > 0 ? $$('.row').length : null), 15000)
check('专辑跳转', !!albumHash && albumRows > 0, { hash: albumHash, albumRows })

/* ------------------------------ 9. 艺人跳转 ------------------------------ */
window.location.hash = '#/search'
await sleep(900)
const singerRow = $$('.results .row')[0]
const singerName = singerRow?.querySelector('.singer')?.innerText?.trim() ?? ''
singerRow?.querySelector('.singer')?.click()
const kwAfter = await waitFor('艺人跳转触发搜索', () => {
  const kw = $('.search-box input')?.value ?? ''
  return kw && kw === singerName ? kw : null
}, 10000)
await sleep(1500)
check('艺人跳转', !!kwAfter, { singerName, keywordAfter: kwAfter, rows: $$('.results .row').length })

/* ------------------------------ 10. 歌单页操作 ------------------------------ */
window.location.hash = '#/library'
await sleep(1200)
$$('.actions .tabs button').find((b) => b.innerText.includes('歌单'))?.click()
await sleep(700)
const plItem = $$('.pl-item').find((el) => el.innerText.includes('render-perf 回归歌单'))
plItem?.click()
await sleep(700)
const plRows = $$('.songs .row').length
const plRowText = $$('.songs .row')[0]?.innerText?.replace(/\s+/g, ' ').slice(0, 60) ?? null
check('歌单页展示曲目', plRows === 1 && !!plRowText, { plRows, firstRow: plRowText })

// 移除该曲目（行内移除按钮）
$$('.songs .row')[0]?.querySelector('button[title*="移除"]')?.click()
await sleep(900)
const afterRemove = (await window.api.library.snapshot()).playlists.find((p) => p.name === 'render-perf 回归歌单')
check('歌单内移除曲目', (afterRemove?.songs?.length ?? -1) === 0, { songsAfterRemove: afterRemove?.songs?.length ?? null })

// 重命名
const renameTarget = $$('.pl-item').find((el) => el.innerText.includes('render-perf 回归歌单'))
const plId = afterRemove?.id
await window.api.library.playlist({ type: 'rename', id: plId, name: 'render-perf 回归歌单-改名' })
await sleep(600)
const renamed = (await window.api.library.snapshot()).playlists.find((p) => p.id === plId)
check('歌单重命名', renamed?.name === 'render-perf 回归歌单-改名', { name: renamed?.name ?? null, renameTargetFound: !!renameTarget })

// 删除（走 IPC，避开 window.confirm 阻塞）
await window.api.library.playlist({ type: 'remove', id: plId })
await sleep(600)
const deleted = (await window.api.library.snapshot()).playlists.find((p) => p.id === plId)
check('歌单删除', !deleted, { stillThere: !!deleted })

/* ------------------------------ 11. 反复进出不泄漏 ------------------------------ */
const heap = () => performance.memory?.usedJSHeapSize ?? 0
window.location.hash = '#/search'
await sleep(1500)
const heapStart = heap()
const rowsStart = $$('.results .row').length
for (let i = 0; i < 4; i += 1) {
  window.location.hash = '#/library'
  await sleep(700)
  window.location.hash = '#/search'
  await sleep(900)
}
await waitFor('回到搜索页行数恢复', () => ($$('.results .row').length > 0 ? true : null), 8000)
globalThis.gc?.()
const heapEnd = heap()
const rowsEnd = $$('.results .row').length
check('反复切换页面后行数与堆内存稳定', rowsEnd === rowsStart && heapEnd < heapStart * 1.6, {
  heapStartMB: Number((heapStart / 1048576).toFixed(1)),
  heapEndMB: Number((heapEnd / 1048576).toFixed(1)),
  rowsStart,
  rowsEnd
})

/* ------------------------------ 12. 下载进度事件频率 ------------------------------ */
const dlSong = searchStore.visibleSongs[20]
const progressStamps = []
const off = window.api.on(window.api.events.downloadProgress, () => progressStamps.push(performance.now()))
const addRes = await window.api.download.add({ songs: [JSON.parse(JSON.stringify(dlSong))] })
await sleep(6000)
off()
const ids = (addRes ?? []).map((t) => t.id)
const list = await window.api.download.list()
const mine = list.filter((t) => ids.includes(t.id))
await window.api.download.remove(ids, true)
const windowSec = 6
check('下载进度事件已节流（≤5 次/秒/任务）', progressStamps.length / windowSec <= 5, {
  events: progressStamps.length,
  perSecond: Number((progressStamps.length / windowSec).toFixed(2)),
  taskStatus: mine.map((t) => `${t.status}:${Math.round(t.progress)}%`)
})

out.summary = {
  total: Object.keys(out.checks).length,
  passed: Object.values(out.checks).filter((c) => c.pass).length,
  failed: Object.keys(out.checks).filter((k) => !out.checks[k].pass)
}
return out
