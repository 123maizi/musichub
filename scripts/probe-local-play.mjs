/**
 * 完整链路：搜索 → 下载 → 下载页播放（应用内）。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const bodyText = () => document.body.innerText.replace(/\s+/g, ' ')
const timeRow = () => document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? ''

/* 1. 搜索并下载第一首 */
window.location.hash = '#/search'
await sleep(2000)
const input = document.querySelector('.search-box input')
input.focus()
input.value = '蛋堡 关于小熊'
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(300)
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))

let rows = 0
for (let i = 0; i < 20; i += 1) {
  await sleep(1000)
  rows = document.querySelectorAll('.results .row').length
  if (rows > 0) break
}
if (rows === 0) return JSON.stringify({ step: '搜索无结果' })

const firstRow = document.querySelector('.results .row')
const rowText = firstRow.innerText.replace(/\s+/g, ' ').slice(0, 60)
const dlBtn = firstRow.querySelector('.col-actions button[title="下载"]')
if (!dlBtn) return JSON.stringify({ step: '找不到下载按钮' })
dlBtn.click()

/* 2. 等下载完成 */
window.location.hash = '#/downloads'
await sleep(1500)
let done = false
for (let i = 0; i < 60; i += 1) {
  await sleep(1000)
  const t = bodyText()
  if (t.includes('已完成')) {
    done = true
    break
  }
  if (t.includes('失败')) break
}
const dlState = bodyText().slice(-320)

/* 3. 点播放 */
const playBtn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '播放')
if (!playBtn) {
  return JSON.stringify({ step: '下载完成但找不到播放按钮', 下载完成: done, dlState }, null, 1)
}
playBtn.click()

const timeline = []
for (let i = 0; i < 12; i += 1) {
  await sleep(1000)
  timeline.push({
    秒: i + 1,
    播放条: timeRow(),
    音源: document.querySelector('.src-name')?.innerText ?? '',
    曲目: document.querySelector('.now-title')?.innerText ?? '',
    错误: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 60) ?? ''
  })
}

return JSON.stringify({ 下载的曲目: rowText, 下载完成: done, 时间线: timeline }, null, 1)
