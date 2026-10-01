/** 把一首歌真正放起来，并确认 seek 输入框已启用（max>0）—— seekpos 探针的前置条件 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

const rail = (label) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(label)
  )
rail('搜索')?.click()
await sleep(2000)

// 搜出结果
const input = document.querySelector('.search-box input')
if (input) {
  input.focus()
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(200)
  input.value = '周杰伦'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
}
for (let i = 0; i < 30; i += 1) {
  await sleep(1000)
  if (document.querySelectorAll('.results .row').length > 0) break
}
out.结果行数 = document.querySelectorAll('.results .row').length

// 播第一首
document.querySelector('.results .row .col-actions button[title="播放"]')?.click()
await sleep(6000)

// 必须切到正在播放页 —— 否则 input.seek 还没挂载，前面那次就是这样误判成「没找到」
if (!location.hash.includes('now-playing')) {
  location.hash = '#/now-playing'
}
for (let i = 0; i < 20; i += 1) {
  await sleep(700)
  if (document.querySelector('input.seek')) break
}

// 确认 seek 输入框状态
const el = document.querySelector('input.seek')
out.seek输入框 = el
  ? { max: el.max, value: el.value, disabled: el.disabled, step: el.step }
  : '没找到'
out.可直接跑seekpos = el && !el.disabled && Number(el.max) > 0 ? '✓ 前置条件满足' : '✗ 仍不可用'

return JSON.stringify(out, null, 1)
