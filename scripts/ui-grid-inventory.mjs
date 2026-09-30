/**
 * 栅格结构实测（给「重新设计板块」用）：
 *  1. 外壳：侧栏宽度 / 内容区宽度 / 内边距
 *  2. SongTable：7 列栅格的实际像素分配（computed grid-template-columns + 每列 rect）
 *  3. 各列内容实际需要多宽（标题 / 歌手 / 专辑 / 音质 / 时长 / 操作按钮组）
 *  4. 艺人/专辑网格：列数与列宽（auto-fill）
 *  5. 库页歌单分栏宽度
 * 这样新骨架（窄导航 64px + 大留白）出来后可以直接按数字重排，不用现场量。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const px = (v) => Math.round(Number(v) * 10) / 10
const out = {}

/* ---------- 准备 140 行 ---------- */
window.location.hash = '#/search'
await sleep(800)
const search = store('search')
const res = await window.api.search.search({ keyword: '周杰伦', limit: 200 })
const seen = new Set()
const merged = []
for (const g of res.platforms ?? []) for (const s of g.songs ?? []) { if (!seen.has(s.id)) { seen.add(s.id); merged.push(s) } }
search.activePlatform = 'all'
search.platforms = [{ platform: 'kw', providerName: 'bench', songs: merged.slice(0, 140), error: null }]
for (let i = 0; i < 200; i += 1) { if ($$('.results .row').length === 140) break; await sleep(40) }
await sleep(400)

/* ---------- 1. 外壳 ---------- */
const shell = $('.shell')
const sidebar = $('.sidebar')
const main = $('.main')
out.shell = {
  viewport: { w: window.innerWidth, h: window.innerHeight },
  shellGrid: shell ? getComputedStyle(shell).gridTemplateColumns : null,
  sidebarW: sidebar ? px(sidebar.getBoundingClientRect().width) : null,
  mainW: main ? px(main.getBoundingClientRect().width) : null,
  playerbarH: $('.player-bar') ? px($('.player-bar').getBoundingClientRect().height) : null
}

/* ---------- 2. SongTable 栅格 ---------- */
const head = $('.results .head')
const body = $('.results .body')
const row0 = $('.results .row')
const headCells = head ? [...head.children] : []
const rowCells = row0 ? [...row0.children] : []
const rectOf = (el) => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: px(r.left), w: px(r.width), h: px(r.height) }
}
out.songTable = {
  containerW: body ? px(body.getBoundingClientRect().width) : null,
  headComputed: head ? getComputedStyle(head).gridTemplateColumns : null,
  rowComputed: row0 ? getComputedStyle(row0).gridTemplateColumns : null,
  gap: row0 ? getComputedStyle(row0).gap : null,
  padding: row0 ? `${getComputedStyle(row0).paddingLeft} / ${getComputedStyle(row0).paddingRight}` : null,
  rowHeight: row0 ? px(row0.getBoundingClientRect().height) : null,
  headCells: headCells.map((el) => ({ cls: el.className, ...rectOf(el) })),
  rowCells: rowCells.map((el) => ({ cls: el.className, ...rectOf(el) })),
  actionButtons: row0 ? [...row0.querySelectorAll('.col-actions button')].map((b) => ({ title: b.title, w: px(b.getBoundingClientRect().width) })) : [],
  actionGroupW: row0 ? rectOf(row0.querySelector('.col-actions')) : null,
  miniCover: row0 ? rectOf(row0.querySelector('.mini-cover')) : null
}

/* ---------- 3. 各列内容实际需要多宽（取前 40 行最长值） ---------- */
function textWidth(text, el) {
  const span = document.createElement('span')
  const cs = el ? getComputedStyle(el) : null
  span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;font:${cs ? cs.font : '13px sans-serif'};letter-spacing:${cs ? cs.letterSpacing : 'normal'}`
  span.textContent = text
  document.body.appendChild(span)
  const w = px(span.getBoundingClientRect().width)
  span.remove()
  return w
}
const rows = $$('.results .row').slice(0, 40)
const sample = rows.map((r) => ({
  title: r.querySelector('.title')?.innerText ?? '',
  singer: r.querySelector('.singer')?.innerText ?? '',
  album: r.querySelector('.col-album')?.innerText ?? '',
  platform: r.querySelector('.col-platform .tag')?.innerText ?? '',
  quality: r.querySelector('.col-quality .tag')?.innerText ?? '',
  time: r.querySelector('.col-time')?.innerText ?? ''
}))
const longest = (key) => sample.reduce((a, b) => ((b[key] ?? '').length > (a[key] ?? '').length ? b : a), {})
const titleEl = row0?.querySelector('.title')
const singerEl = row0?.querySelector('.singer')
const albumEl = row0?.querySelector('.col-album')
const timeEl = row0?.querySelector('.col-time')
out.contentNeeds = {
  title: { sample: longest('title').title, px: textWidth(longest('title').title, titleEl), currentTrack: out.songTable.rowComputed?.split(' ')[1] ?? null },
  singer: { sample: longest('singer').singer, px: textWidth(longest('singer').singer, singerEl) },
  album: { sample: longest('album').album, px: textWidth(longest('album').album, albumEl) },
  time: { sample: longest('time').time, px: textWidth('00:00', timeEl) },
  platformTag: row0?.querySelector('.col-platform .tag') ? rectOf(row0.querySelector('.col-platform .tag')) : null,
  qualityTag: row0?.querySelector('.col-quality .tag') ? rectOf(row0.querySelector('.col-quality .tag')) : null,
  /* 衬线宽字距的预估：同字号下最坏情况按 +14% 计 */
  titleWithSerif14pct: Math.round(textWidth(longest('title').title, titleEl) * 1.14)
}

/* ---------- 4. 艺人/专辑网格 ---------- */
const grid = $('.artist-grid')
if (!grid) {
  // 切到歌手模式看一眼
  const artistBtn = $$('.meta-row .channels button').find((b) => b.innerText.trim() === '歌手')
  artistBtn?.click()
  const input = $('.search-box input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '周杰伦')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  $$('.search-box button').find((b) => b.innerText.includes('搜索'))?.click()
  for (let i = 0; i < 120; i += 1) { if ($$('.artist-card').length > 0) break; await sleep(150) }
}
const g2 = $('.artist-grid')
out.artistGrid = g2
  ? {
      computed: getComputedStyle(g2).gridTemplateColumns,
      columns: getComputedStyle(g2).gridTemplateColumns.split(' ').length,
      cardW: $$('.artist-card')[0] ? px($$('.artist-card')[0].getBoundingClientRect().width) : null,
      gap: getComputedStyle(g2).gap,
      cards: $$('.artist-card').length
    }
  : null

/* ---------- 5. 库页歌单分栏 ---------- */
window.location.hash = '#/library'
await sleep(1200)
$$('.actions .tabs button').find((b) => b.innerText.includes('歌单'))?.click()
await sleep(700)
const pl = $('.playlists')
out.librarySplit = pl
  ? { playlistsW: px(pl.getBoundingClientRect().width), songsW: $('.songs') ? px($('.songs').getBoundingClientRect().width) : null }
  : null

/* ---------- 6. 视图内边距（新骨架要提到 32~40px） ---------- */
window.location.hash = '#/search'
await sleep(900)
const header = $('.header')
out.paddings = {
  searchHeader: header ? getComputedStyle(header).padding : null,
  results: $('.results') ? getComputedStyle($('.results')).padding : null,
  albumHero: null,
  artistHero: null
}

return out
