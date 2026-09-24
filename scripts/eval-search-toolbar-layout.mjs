/* 搜索结果页：确认工具条里的格式选择器没有挤坏布局 */
window.location.hash = '#/search'
await new Promise((r) => setTimeout(r, 2200))
const input = document.querySelector('.search-box input')
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await new Promise((r) => setTimeout(r, 150))
input.value = '周杰伦'
input.dispatchEvent(new Event('input', { bubbles: true }))
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
for (let i = 0; i < 25; i += 1) {
  await new Promise((r) => setTimeout(r, 1000))
  if (document.querySelectorAll('.results .row').length) break
}

const inline = document.querySelector('.fmt-inline')
const head = document.querySelector('.header')
const opts = [...document.querySelectorAll('.fmt-inline .opt')]
const rects = opts.map((b) => {
  const r = b.getBoundingClientRect()
  return { t: b.innerText.replace(/\s+/g, ' ').trim(), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }
})
const inlineRect = inline?.getBoundingClientRect()
const overflowX = inline ? inline.scrollWidth > inline.clientWidth : null

return JSON.stringify({
  工具条里有格式选择器: Boolean(inline),
  按钮尺寸: rects,
  说明行位置: inlineRect ? { w: Math.round(inlineRect.width), h: Math.round(inlineRect.height) } : null,
  横向溢出: overflowX,
  结果行数: document.querySelectorAll('.results .row').length,
  页面高: document.documentElement.scrollHeight,
  视口: { w: innerWidth, h: innerHeight }
})
