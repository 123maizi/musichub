/**
 * 覆盖层渲染验证（不依赖鼠标输入）：
 *  1. 播放一首 → 当前行 .playing 的 ::after opacity 必须 = 1
 *  2. 多选勾选一行 → .selected 的 ::after opacity 必须 = 1
 *  3. 两种状态的伪元素颜色/刻线是否符合契约（极淡底 + inset 2px 刻线）
 *  4. 顺带确认内容在覆盖层之上（伪元素 z-index:-1、行自身无 z-index、表容器 isolation=isolate）
 *  5. :hover 规则是否在样式表里（鼠标合成事件在本环境不可靠，规则存在性 + 同机制的状态路径可证）
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $$ = (s) => [...document.querySelectorAll(s)]
const $ = (s) => document.querySelector(s)
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const out = {}

window.location.hash = '#/search'
await sleep(800)
const search = store('search')
const player = store('player')
if (search.visibleSongs.length === 0) {
  const input = $('.search-box input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '周杰伦')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(150)
  $$('button').find((b) => b.innerText.trim() === '搜索')?.click()
  for (let i = 0; i < 200; i += 1) { if ($$('.results .row').length > 0) break; await sleep(100) }
}
const body = $('.results .body')
body.scrollTop = 0
await sleep(300)

/* 1. 播放第一行 → .playing */
$$('.results .row')[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
for (let i = 0; i < 120; i += 1) { if ($('.results .row.playing')) break; await sleep(150) }
await sleep(400)
const playingRow = $('.results .row.playing')
out.playing = playingRow
  ? {
      index: $$('.results .row').indexOf(playingRow),
      afterOpacity: getComputedStyle(playingRow, '::after').opacity,
      afterBg: getComputedStyle(playingRow, '::after').backgroundColor,
      rowBoxShadow: getComputedStyle(playingRow).boxShadow,
      beforeOpacity: getComputedStyle(playingRow, '::before').opacity
    }
  : null

/* 2. 多选勾一行 → .selected */
const findBtn = (t) => $$('button').find((b) => b.innerText.includes(t))
findBtn('多选')?.click()
await sleep(500)
const boxes = $$('.results .row .row-check')
if (boxes[2]) {
  boxes[2].click()
  await sleep(500)
}
const selectedRow = $('.results .row.selected')
out.selected = selectedRow
  ? {
      index: $$('.results .row').indexOf(selectedRow),
      afterOpacity: getComputedStyle(selectedRow, '::after').opacity,
      afterBg: getComputedStyle(selectedRow, '::after').backgroundColor,
      rowBoxShadow: getComputedStyle(selectedRow).boxShadow
    }
  : null

/* 3. 非状态行必须没有覆盖层 */
const plainRow = $$('.results .row').find((r) => !r.classList.contains('playing') && !r.classList.contains('selected'))
out.plain = plainRow
  ? {
      afterOpacity: getComputedStyle(plainRow, '::after').opacity,
      beforeOpacity: getComputedStyle(plainRow, '::before').opacity,
      rowBackground: getComputedStyle(plainRow).backgroundColor,
      rowBoxShadow: getComputedStyle(plainRow).boxShadow
    }
  : null

/* 4. 层叠结构 */
out.stacking = {
  tableIsolation: getComputedStyle($('.table')).isolation,
  rowPosition: getComputedStyle($$('.results .row')[0]).position,
  rowZIndex: getComputedStyle($$('.results .row')[0]).zIndex,
  pseudoZIndex: getComputedStyle($$('.results .row')[0], '::after').zIndex,
  headZIndex: getComputedStyle($('.results .head')).zIndex,
  headBackground: getComputedStyle($('.results .head')).backgroundColor
}

/* 5. :hover 规则存在性（扫样式表） */
let hoverRule = null
for (const sheet of document.styleSheets) {
  let rules
  try {
    rules = sheet.cssRules
  } catch {
    continue
  }
  for (const r of rules) {
    if (r.selectorText && /\.row:hover::before/.test(r.selectorText)) hoverRule = { selector: r.selectorText, css: r.style.cssText.slice(0, 60) }
  }
}
out.hoverRule = hoverRule

/* 退出多选，别留状态 */
findBtn('退出多选')?.click()
await sleep(300)
return out
