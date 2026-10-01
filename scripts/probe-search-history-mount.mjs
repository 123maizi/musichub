/**
 * 搜索历史下拉挂载验收（组件归 main-lifecycle，挂载点归 SearchView）
 *
 * 断言：
 *   1. 键入不写历史；真正发起搜索（回车 / 点搜索按钮）才写
 *   2. 连续搜 3 个词 → 历史 3 条且最新在最前；重复词不产生重复项
 *   3. 聚焦且有历史 → 下拉展开（.history-pop 出现）；点历史项 → 真的搜出结果且下拉关闭
 *   4. 点外面 → 下拉关闭
 *   5. 优先级：无结果 + 聚焦 → 下拉与空态列表共存；有结果 + 聚焦 → 只有下拉
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
const input = () => $('.search-box input')
const typeInto = async (text) => {
  const el = input()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(120)
}
const pressEnter = async () => {
  input().dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
}
const clickSearchButton = async () => {
  const btn = $$('.search-box button').find((b) => b.innerText.includes('搜索'))
  btn?.click()
}
const waitSearchSettled = async (timeout = 15000) => {
  const t0 = performance.now()
  while (performance.now() - t0 < timeout) {
    if (!search.loading) return true
    await sleep(100)
  }
  return false
}
const historyWords = async () => (await window.api.prefs.get()).searchHistory ?? []

/* ---------- 准备：清空历史，回到搜索页 ---------- */
window.location.hash = '#/search'
for (let i = 0; i < 100; i += 1) {
  if (input()) break
  await sleep(80)
}
await window.api.prefs.clearSearchHistory()
search.keyword = ''
search.platforms = []
await sleep(400)

/* ---------- 1. 键入不写历史 ---------- */
input().focus()
await typeInto('晴天')
await typeInto('晴天周杰伦')
await sleep(300)
const afterTyping = await historyWords()
check('键入不写历史', afterTyping.length === 0, { history: afterTyping, typed: ['晴天', '晴天周杰伦'] })

/* ---------- 2. 回车写入 + 顺序 + 去重 ---------- */
await typeInto('晴天')
await pressEnter()
await waitSearchSettled()
await sleep(300)
const afterFirst = await historyWords()
check('回车发起搜索 → 写入历史', afterFirst.includes('晴天'), { history: afterFirst })

await typeInto('七里香')
await clickSearchButton()
await waitSearchSettled()
await sleep(300)
await typeInto('稻香')
await pressEnter()
await waitSearchSettled()
await sleep(300)
const afterThree = await historyWords()
check('连续 3 次搜索 → 3 条且最新在最前', afterThree.length === 3 && afterThree[0] === '稻香', { history: afterThree })

await typeInto('晴天')
await pressEnter()
await waitSearchSettled()
await sleep(400)
const afterRepeat = await historyWords()
check('重复搜同一个词不产生重复项', afterRepeat.length === 3 && afterRepeat[0] === '晴天' && afterRepeat.filter((w) => w === '晴天').length === 1, {
  history: afterRepeat
})

/* ---------- 3. 聚焦展开 + 点历史项搜索 ---------- */
await typeInto('')
input().blur()
await sleep(200)
// 用真实 click 打开：本实例窗口不是 OS 前台窗口时 document.hasFocus() 为 false，
// 且输入框挂载时已被自动聚焦 —— 此时 .focus() 是空操作、不会派发 focus 事件。
// 这也正是线上「点一下已经聚焦的输入框」的真实路径，所以按 click 走。
input().dispatchEvent(new MouseEvent('click', { bubbles: true }))
input().focus()
await sleep(600)
const pop = $('.history-pop')
check('聚焦且有历史 → 下拉展开', !!pop, {
  pop: !!pop,
  rows: $$('.history-pop .row').length,
  words: $$('.history-pop .word').map((w) => w.innerText.trim())
})

// 点第一条历史（晴天）
const firstItem = $$('.history-pop .row')[0]
const pickedWord = firstItem?.querySelector('.word')?.innerText?.trim() ?? null
firstItem?.click()
await waitSearchSettled()
await sleep(500)
const afterPick = {
  keyword: search.keyword,
  results: $$('.results .row').length,
  popGone: !$('.history-pop'),
  history: await historyWords()
}
check('点历史项 → 真的搜出结果 + 下拉关闭 + 该词提到最前', afterPick.results > 0 && afterPick.popGone && afterPick.history[0] === pickedWord, {
  pickedWord,
  ...afterPick
})

/* ---------- 4. 点外面关闭 ---------- */
await typeInto('')
input().dispatchEvent(new MouseEvent('click', { bubbles: true }))
await sleep(400)
const popBefore = !!$('.history-pop')
// 点页面空白处（推荐区/内容区），不要点输入框
const outside = $('.view') ?? document.body
outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
outside.dispatchEvent(new MouseEvent('click', { bubbles: true }))
await sleep(500)
check('点外面 → 下拉关闭', popBefore && !$('.history-pop'), { opened: popBefore, closed: !$('.history-pop') })

/* ---------- 5. 与空态列表的共存/互斥 ---------- */
// 5a. 无结果 + 聚焦：下拉 + 空态列表都在
search.keyword = ''
search.platforms = []
await sleep(500)
input().dispatchEvent(new MouseEvent('click', { bubbles: true }))
await sleep(500)
const coexist = {
  pop: !!$('.history-pop'),
  recommend: !!$('.recommend'),
  panelRows: $$('.recommend .row').length,
  resultRows: $$('.results .row').length
}
check('无结果 + 聚焦：下拉浮层与空态列表共存', coexist.pop && coexist.recommend && coexist.resultRows === 0, coexist)

// 5b. 有结果 + 聚焦：只有下拉，空态列表不渲染
await typeInto('周杰伦')
await pressEnter()
await waitSearchSettled()
for (let i = 0; i < 100; i += 1) {
  if ($$('.results .row').length > 0) break
  await sleep(80)
}
input().dispatchEvent(new MouseEvent('click', { bubbles: true }))
await sleep(500)
const withResults = { pop: !!$('.history-pop'), recommend: !!$('.recommend'), resultRows: $$('.results .row').length }
check('有结果 + 聚焦：只有下拉，空态列表不渲染', withResults.resultRows > 0 && !withResults.recommend, withResults)

out.history = await historyWords()
out.summary = {
  total: Object.keys(out.checks).length,
  passed: Object.values(out.checks).filter((c) => c.pass).length,
  failed: Object.keys(out.checks).filter((k) => !out.checks[k].pass)
}
return out
