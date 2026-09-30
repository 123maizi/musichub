/** 诊断：专辑跳转 / 歌单页为什么在回归里失败（区分 chunk 404 与逻辑问题） */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const out = {}

window.location.hash = '#/search'
await sleep(900)
const search = store('search')
if (search.visibleSongs.length === 0) return { skipped: '没有搜索结果' }

/* 1. 专辑跳转 */
const idx = search.visibleSongs.findIndex((s) => s.albumName && s.albumName.trim())
const row = $$('.results .row')[idx]
out.albumClick = {
  rowIndex: idx,
  albumText: row?.querySelector('.col-album')?.innerText ?? null,
  hasHandler: !!row?.querySelector('.col-album')
}
row?.querySelector('.col-album')?.click()
await sleep(2500)
out.afterAlbumClick = {
  hash: location.hash,
  viewRendered: !!$('.view, section.view'),
  h1: $('h1')?.innerText ?? null,
  heroPresent: !!$('.hero'),
  rowCount: $$('.row').length,
  bodyHead: document.body.innerText.replace(/\s+/g, ' ').slice(0, 120)
}

/* 2. 歌单页：tab 切换 + 列表渲染 */
window.location.hash = '#/library'
await sleep(2000)
const tabs = $$('.actions .tabs button').map((b) => b.innerText.trim())
out.library = {
  hash: location.hash,
  viewRendered: !!$('.view'),
  tabs,
  tabCount: tabs.length,
  bodyHead: document.body.innerText.replace(/\s+/g, ' ').slice(0, 140)
}
const plTab = $$('.actions .tabs button').find((b) => b.innerText.includes('歌单'))
plTab?.click()
await sleep(1200)
out.library.afterPlaylistTab = {
  plItems: $$('.pl-item').length,
  plNames: $$('.pl-item').map((e) => e.innerText.replace(/\s+/g, ' ').trim()).slice(0, 5),
  songRows: $$('.songs .row').length,
  emptyHint: $('.empty-hint')?.innerText?.trim() ?? null
}

/* 3. 直接看 IPC 层面的歌单数据（排除渲染问题） */
const snap = await window.api.library.snapshot()
out.playlistsFromIpc = (snap.playlists ?? []).map((p) => ({ name: p.name, songs: p.songs.length }))

return out
