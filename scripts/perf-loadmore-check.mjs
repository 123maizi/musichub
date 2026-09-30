/** 「加载更多」到底是追加还是翻页 —— 用首行内容对比来判定 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const search = store('search')

window.location.hash = '#/search'
await sleep(800)
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
    if (search.visibleSongs.length > 0) break
  }
}
await sleep(500)
const beforeIds = search.visibleSongs.map((s) => s.id)
const beforeFirst = search.visibleSongs[0]?.name
const pageBefore = search.page

$$('.pager button').find((b) => b.innerText.includes('加载更多'))?.click()
await sleep(6000)
const afterIds = search.visibleSongs.map((s) => s.id)
const overlap = afterIds.filter((id) => beforeIds.includes(id)).length

return {
  pageBefore,
  pageAfter: search.page,
  countBefore: beforeIds.length,
  countAfter: afterIds.length,
  firstBefore: beforeFirst,
  firstAfter: search.visibleSongs[0]?.name,
  overlapCount: overlap,
  verdict:
    afterIds.length > beforeIds.length
      ? '追加模式'
      : overlap === afterIds.length
        ? '完全同一批（翻页无变化）'
        : '整体替换为新一页（不是追加）'
}
