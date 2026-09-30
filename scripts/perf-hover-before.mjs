/** 覆盖层可见性验证：真实鼠标移到行上，读伪元素的实际 opacity 与颜色 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $$ = (s) => [...document.querySelectorAll(s)]
const $ = (s) => document.querySelector(s)
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const out = {}

window.location.hash = '#/search'
await sleep(800)
const search = store('search')
if (search.visibleSongs.length === 0) {
  const input = $('.search-box input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '周杰伦')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(150)
  $$('button').find((b) => b.innerText.trim() === '搜索')?.click()
  for (let i = 0; i < 150; i += 1) { if ($$('.results .row').length > 0) break; await sleep(100) }
}
// 先滚回顶部，否则第 0 行可能在视口上方（rect.top 为负，鼠标点不到）
const body = $('.results .body')
body.scrollTop = 0
await sleep(300)
const row = $$('.results .row')[0]
const rect = row.getBoundingClientRect()

const readState = (label) => {
  const cs = getComputedStyle(row)
  const before = getComputedStyle(row, '::before')
  const after = getComputedStyle(row, '::after')
  return {
    label,
    rowBackground: cs.backgroundColor,
    rowBoxShadow: cs.boxShadow,
    beforeOpacity: before.opacity,
    beforeBg: before.backgroundColor,
    afterOpacity: after.opacity,
    afterBg: after.backgroundColor,
    tableIsolation: getComputedStyle($('.table')).isolation
  }
}

out.beforeHover = readState('鼠标未移到行上')

// 真实鼠标移动（合成事件不会触发 :hover）
window.__hoverAt = { x: Math.round(rect.left + 200), y: Math.round(rect.top + rect.height / 2) }
return { ...out, hoverTarget: window.__hoverAt, note: '下一步由 Node 侧派发真实 mouseMoved 后再读一次' }
