/** 用户反馈三件的实测验收：分页行高度 / 顶栏控件数 / 缩略图圆角 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $$ = (s) => [...document.querySelectorAll(s)]
const $ = (s) => document.querySelector(s)
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const px = (v) => Math.round(Number(v) * 10) / 10
const out = {}

window.location.hash = '#/search'
for (let i = 0; i < 100; i += 1) { if ($('.search-box input')) break; await sleep(80) }
const search = store('search')
// 用 API 结果注入（确定性，不依赖搜索按钮的时序）
const res = await window.api.search.search({ keyword: '周杰伦', limit: 60 })
const seen = new Set()
const merged = []
for (const g of res.platforms ?? []) for (const s of g.songs ?? []) { if (!seen.has(s.id)) { seen.add(s.id); merged.push(s) } }
search.activePlatform = 'all'
search.keyword = '周杰伦'
if (merged.length > 0) search.platforms = [{ platform: 'kw', providerName: 'verify', songs: merged, error: null }]
for (let i = 0; i < 200; i += 1) { if ($$('.results .row').length > 0) break; await sleep(80) }
await sleep(600)

/* 1. 分页行 */
const pager = $('.pager')
if (pager) {
  const cs = getComputedStyle(pager)
  const r = pager.getBoundingClientRect()
  out.pager = {
    heightPx: px(r.height),
    padding: `${cs.paddingTop} / ${cs.paddingBottom}`,
    gap: cs.columnGap,
    items: [...pager.children].map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: el.className,
      text: el.innerText.trim().replace(/\s+/g, ' '),
      h: px(el.getBoundingClientRect().height),
      w: px(el.getBoundingClientRect().width)
    })),
    under40: px(r.height) <= 40
  }
} else {
  out.pager = { missing: true }
}

/* 2. 顶栏控件 */
const actions = $('#page-actions')
out.topbar = actions
  ? {
      controls: [...actions.children].map((el) => ({ tag: el.tagName.toLowerCase(), text: el.innerText.trim().replace(/\s+/g, ' ').slice(0, 24) })),
      count: actions.children.length,
      height: px(actions.getBoundingClientRect().height)
    }
  : { missing: true }

/* 3. 下载格式是否回到内容区工具行 */
const fmt = $('.meta-row .fmt-inline')
out.formatPicker = fmt
  ? { inToolbar: true, text: fmt.innerText.trim().replace(/\s+/g, ' ').slice(0, 40), inTopbar: !!actions?.querySelector('.fmt-inline') }
  : { inToolbar: false }

/* 4. 缩略图圆角 */
const cover = $('.results .row .mini-cover')
if (cover) {
  const cs = getComputedStyle(cover)
  const img = cover.querySelector('img')
  out.thumbnail = {
    w: px(cover.getBoundingClientRect().width),
    radius: cs.borderTopLeftRadius,
    overflow: cs.overflow,
    imgRadius: img ? getComputedStyle(img).borderTopLeftRadius : null,
    rMediaDefined: getComputedStyle(document.documentElement).getPropertyValue('--r-media').trim() || '(未定义)'
  }
}

/* 5. 大图/头像不应受媒体圆角影响 */
out.otherMedia = {
  albumHeroRadius: $('.cover-wrap') ? getComputedStyle($('.cover-wrap')).borderTopLeftRadius : null,
  artistAvatarRadius: $('.avatar') ? getComputedStyle($('.avatar')).borderTopLeftRadius : null
}

/* 6. 列表仍完整 */
out.rows = $$('.results .row').length
return out
