/**
 * 用户视角的播放流程观察。
 *
 * 之前几次测试都用 document.querySelector('audio') 判断是否在播放 ——
 * 那是错的：播放器用 new Audio() 创建游离元素，不进 DOM，永远查不到。
 * 所以改成读播放条上真实显示的数字。
 *
 * 观察点：
 *   - 时间/总时长 的推进
 *   - 是否出现错误提示
 *   - verifyDuration 有没有把「试听片段源」换掉
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 1. 搜一首，点播放
window.location.hash = '#/search'
await sleep(1500)
const input = document.querySelector('.search-box input')
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(200)
input.value = '蛋堡 关于小熊'
input.dispatchEvent(new Event('input', { bubbles: true }))
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
await sleep(7000)

const first = document.querySelector('.results .row')
if (!first) return JSON.stringify({ step: 'search', ok: false })
const playBtn = first.querySelector('.col-actions button[title="播放"]')
const b = playBtn.getBoundingClientRect()
const rowText = first.innerText.replace(/\s+/g, ' ').slice(0, 60)

// 真点击：让 Vue 的 @click 收到事件
playBtn.click()

const timeline = []
for (let i = 0; i < 26; i += 1) {
  await sleep(1000)
  const timeRow = document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? ''
  const err = document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 90) ?? ''
  const src = document.querySelector('.src-name')?.innerText ?? ''
  timeline.push(`${i}s  ${timeRow}  [${src}]${err ? '  ⚠ ' + err : ''}`)
}

return JSON.stringify({ row: rowText, timeline }, null, 1)
