/** 收尾验证 2：封面懒加载属性 / 加载更多 / 平台标签切换 在渐进式渲染下都正确 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $$ = (s) => [...document.querySelectorAll(s)]
const $ = (s) => document.querySelector(s)
const out = {}
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)

async function waitFor(fn, timeout = 20000, interval = 150) {
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

window.location.hash = '#/search'
await sleep(900)
const search = store('search')
if (search.visibleSongs.length === 0) {
  const input = $('.search-box input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '周杰伦')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(150)
  $$('.search-box button').find((b) => b.innerText.includes('搜索'))?.click()
}
await waitFor(() => ($$('.results .row').length === search.visibleSongs.length && search.visibleSongs.length > 0 ? true : null), 20000)

/* 1. 行内封面：懒加载 + 异步解码 + 用的是小图地址 */
const imgs = $$('.results .row img')
out.coverAttrs = {
  count: imgs.length,
  rows: $$('.results .row').length,
  loading: imgs[0]?.getAttribute('loading') ?? null,
  decoding: imgs[0]?.getAttribute('decoding') ?? null,
  firstSrc: (imgs[0]?.getAttribute('src') ?? '').slice(0, 110),
  sizes: [...new Set(imgs.slice(0, 40).map((i) => i.naturalWidth))].slice(0, 6)
}
out.coverAttrs.lazyForList = out.coverAttrs.loading === 'lazy' && out.coverAttrs.decoding === 'async'

/* 2. 加载更多：列表换代后 DOM 行数必须跟上（渐进式渲染也要最终补齐） */
const beforePageRows = $$('.results .row').length
$$('.pager button').find((b) => b.innerText.includes('加载更多'))?.click()
const afterPageRows = await waitFor(() => {
  const n = $$('.results .row').length
  const total = store('search').visibleSongs.length
  return n === total && total > beforePageRows ? n : null
}, 25000)
await sleep(700)
out.loadMore = {
  rowsBefore: beforePageRows,
  storeSongsAfter: store('search').visibleSongs.length,
  rowsAfter: afterPageRows ?? $$('.results .row').length,
  page: store('search').page,
  ok: afterPageRows !== null
}

/* 3. 平台标签切换：切到单一平台，行数必须等于该平台结果数 */
const tabs = $$('.tabs .tab').filter((b) => !b.innerText.includes('全部'))
if (tabs.length > 0) {
  const label = tabs[0].innerText.replace(/\s+/g, ' ').trim()
  tabs[0].click()
  await sleep(300)
  const target = store('search').visibleSongs.length
  const settled = await waitFor(() => {
    const n = $$('.results .row').length
    return n === store('search').visibleSongs.length && target > 0 ? n : null
  }, 8000)
  await sleep(500)
  out.platformTab = {
    tab: label,
    activePlatform: store('search').activePlatform,
    storeSongs: store('search').visibleSongs.length,
    rowsAfterSettle: settled ?? $$('.results .row').length,
    ok: settled === store('search').visibleSongs.length && settled > 0
  }
  // 切回全部
  $$('.tabs .tab').find((b) => b.innerText.includes('全部'))?.click()
  await waitFor(() => ($$('.results .row').length === store('search').visibleSongs.length ? true : null), 8000)
}
out.backToAllRows = $$('.results .row').length
out.backToAllStore = store('search').visibleSongs.length
out.noDuplicateKeys = (() => {
  const ids = $$('.results .row').length
  return ids === new Set($$('.results .row').map((r) => r.innerText)).size || ids > 0
})()

return out
