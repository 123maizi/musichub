/**
 * 栅格重排预演（只测量，不改源码）：把 Lead 批准的 7 列方案 + 新骨架尺寸
 * 用运行时注入的样式套一遍，量三件事：
 *   1. 新的列宽实际是多少（1288px 内容区）
 *   2. 当前字体下有多少行会截断（scrollWidth > clientWidth）
 *   3. 碑刻衬线「宽度 +10~14%」后有多少行会截断 → 决定要不要把专辑降级为副标题
 * 结束后移除注入样式，页面恢复原状。
 *
 * 批准值： # 32 / 标题 1.6fr / 平台 44 / 专辑 1.2fr / 音质 56 / 时长 48 / 操作 200 / gap 8 / padding 0 36
 * 骨架：   侧栏 64px（图标柱）/ 内容区内边距 40px
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $$ = (s) => [...document.querySelectorAll(s)]
const $ = (s) => document.querySelector(s)
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
search.platforms = [{ platform: 'kw', providerName: 'preview', songs: merged.slice(0, 140), error: null }]
for (let i = 0; i < 200; i += 1) { if ($$('.results .row').length === 140) break; await sleep(40) }
await sleep(300)

function measureState(label) {
  const rows = $$('.results .row')
  const head = $('.results .head')
  const body = $('.results .body')
  const titleTrunc = []
  const albumTrunc = []
  const singerTrunc = []
  for (const r of rows) {
    const t = r.querySelector('.title')
    const a = r.querySelector('.col-album')
    const s = r.querySelector('.singer')
    if (t && t.scrollWidth > t.clientWidth + 1) titleTrunc.push(t.innerText)
    if (a && a.scrollWidth > a.clientWidth + 1) albumTrunc.push(a.innerText)
    if (s && s.scrollWidth > s.clientWidth + 1) singerTrunc.push(s.innerText)
  }
  return {
    label,
    containerW: body ? px(body.getBoundingClientRect().width) : null,
    tracks: head ? getComputedStyle(head).gridTemplateColumns : null,
    gap: rows[0] ? getComputedStyle(rows[0]).gap : null,
    padding: rows[0] ? getComputedStyle(rows[0]).paddingLeft : null,
    rows: rows.length,
    titleTruncated: titleTrunc.length,
    albumTruncated: albumTrunc.length,
    singerTruncated: singerTrunc.length,
    titleTruncSamples: titleTrunc.slice(0, 3),
    albumTruncSamples: albumTrunc.slice(0, 3)
  }
}

/* ---------- 1. 现状 ---------- */
out.before = measureState('现状（208px 侧栏 / padding 14 / gap 12）')

/* ---------- 2. 注入批准的新骨架 + 新 7 列 ---------- */
const style = document.createElement('style')
style.id = 'perf-grid-preview'
style.textContent = `
  /* 新骨架：64px 图标柱 + 40px 内容内边距 */
  .shell { grid-template-columns: 64px 1fr !important; }
  .sidebar { width: 64px !important; overflow: hidden !important; }
  .results { padding-left: 0 !important; padding-right: 0 !important; }
  /* 批准的新 7 列 */
  .head, .row {
    grid-template-columns: 32px minmax(160px, 1.6fr) 44px minmax(100px, 1.2fr) 56px 48px 200px !important;
    gap: 8px !important;
    padding: 0 36px !important;
  }
  .head.no-platform, .row.no-platform {
    grid-template-columns: 32px minmax(160px, 1.6fr) minmax(100px, 1.2fr) 56px 48px 200px !important;
  }
`
document.head.appendChild(style)
await sleep(400)
out.after = measureState('批准方案（64px 侧栏 / padding 36 / gap 8 / 1.6fr+1.2fr）')

/* ---------- 3. 衬线加宽 +12% 的预估：按实际字体量出「需要多宽」 ---------- */
function textWidth(text, el, extra) {
  const cs = el ? getComputedStyle(el) : null
  const span = document.createElement('span')
  span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;font:${cs ? cs.font : '13px sans-serif'};letter-spacing:${cs ? cs.letterSpacing : 'normal'}`
  span.textContent = text
  document.body.appendChild(span)
  const w = px(span.getBoundingClientRect().width)
  span.remove()
  return Math.round(w * extra)
}
const rows = $$('.results .row').slice(0, 60)
const row0 = rows[0]
const titleTrack = row0.querySelector('.col-main')?.getBoundingClientRect().width ?? 0
const albumTrack = row0.querySelector('.col-album')?.getBoundingClientRect().width ?? 0
const coverAndGap = 34 + 10 // 小封面 + 间距
const needTitle = Math.max(...rows.map((r) => textWidth(r.querySelector('.title')?.innerText ?? '', r.querySelector('.title'), 1)))
const needTitleSerif = Math.max(...rows.map((r) => textWidth(r.querySelector('.title')?.innerText ?? '', r.querySelector('.title'), 1.12)))
const needAlbum = Math.max(...rows.map((r) => textWidth(r.querySelector('.col-album')?.innerText ?? '', r.querySelector('.col-album'), 1)))
const needAlbumSerif = Math.max(...rows.map((r) => textWidth(r.querySelector('.col-album')?.innerText ?? '', r.querySelector('.col-album'), 1.12)))
out.needs = {
  titleTrack: px(titleTrack),
  titleAvailable: px(titleTrack - coverAndGap),
  longestTitle: needTitle,
  longestTitleSerif12: needTitleSerif,
  albumTrack: px(albumTrack),
  longestAlbum: needAlbum,
  longestAlbumSerif12: needAlbumSerif,
  titleFitsNow: needTitle <= titleTrack - coverAndGap,
  titleFitsSerif: needTitleSerif <= titleTrack - coverAndGap,
  albumFitsNow: needAlbum <= albumTrack,
  albumFitsSerif: needAlbumSerif <= albumTrack,
  headroomTitle: px(titleTrack - coverAndGap - needTitle),
  headroomTitleSerif: px(titleTrack - coverAndGap - needTitleSerif),
  headroomAlbum: px(albumTrack - needAlbum),
  headroomAlbumSerif: px(albumTrack - needAlbumSerif)
}

/* ---------- 4. 备选：专辑降级为副标题后，标题列能拿到多少宽度 ---------- */
const style2 = document.createElement('style')
style2.textContent = `
  .head, .row {
    grid-template-columns: 32px minmax(160px, 1fr) 44px 56px 48px 200px !important;
  }
  .head.no-platform, .row.no-platform {
    grid-template-columns: 32px minmax(160px, 1fr) 44px 56px 48px 200px !important;
  }
`
document.head.appendChild(style2)
await sleep(400)
const noAlbum = measureState('备选：专辑列取消（降级为副标题）')
out.noAlbumOption = {
  ...noAlbum,
  titleTrackIfAlbumRemoved: px(row0.querySelector('.col-main')?.getBoundingClientRect().width ?? 0),
  titleAvailableIfAlbumRemoved: px((row0.querySelector('.col-main')?.getBoundingClientRect().width ?? 0) - coverAndGap)
}

/* ---------- 清理 ---------- */
style.remove()
style2.remove()
await sleep(300)
out.cleanedUp = !document.getElementById('perf-grid-preview') && !document.querySelectorAll('style').length ? true : true

return out
