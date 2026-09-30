/** 演示用：跑一次「周杰伦」搜索并把列表滚到顶，供截图看真实观感 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
location.hash = '#/search'
await sleep(1200)
const input = document.querySelector('.search-box input')
if (!input) return 'no search box'
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
setter.call(input, '周杰伦')
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(200)
document.querySelector('.search-box button.primary')?.click()
for (let i = 0; i < 30; i += 1) {
  await sleep(500)
  if (document.querySelectorAll('.results .row').length > 0) break
}
await sleep(9000)
input.blur()
const scroller = document.querySelector('.results .body')
if (scroller) scroller.scrollTop = 0
await sleep(500)
return `rows=${document.querySelectorAll('.results .row').length} title=${document.querySelector('.topbar-title')?.innerText}`
