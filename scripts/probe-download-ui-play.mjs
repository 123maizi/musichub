/**
 * 完整 UI 复现：搜索结果 → 下载 → 下载页点「播放」→ 观察播放器状态。
 * 这是用户实际会走的路径，前面我用音频元素直测并不能覆盖它。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const barText = () => document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? ''
const nowTitle = () => document.querySelector('.now-title')?.innerText?.trim() ?? ''
const srcName = () => document.querySelector('.src-name')?.innerText ?? ''
const errText = () => document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 90) ?? ''

const out = {}

/* 1. 搜一首歌，下载前 3 条 */
window.location.hash = '#/search'
await sleep(2200)
const input = document.querySelector('.search-box input')
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(200)
input.value = '周杰伦 晴天'
input.dispatchEvent(new Event('input', { bubbles: true }))
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))

let rows = []
for (let i = 0; i < 22; i += 1) {
  await sleep(1000)
  rows = [...document.querySelectorAll('.results .row')]
  if (rows.length > 3) break
}

for (const row of rows.slice(0, 3)) {
  row.querySelector('.col-actions button[title="下载"]')?.click()
  await sleep(400)
}
out['1_已加入下载'] = 3

/* 2. 等三个都下完 */
let tasks = []
for (let i = 0; i < 120; i += 1) {
  await sleep(1000)
  tasks = await window.api.download.list()
  if (tasks.length >= 3 && tasks.every((t) => t.status === 'done' || t.status === 'error')) break
}
out['2_任务状态'] = tasks.map((t) => ({
  文件: t.fileName,
  状态: t.status,
  错误: t.error ?? null
}))

/* 3. 去下载页，逐个点「播放」 */
window.location.hash = '#/downloads'
await sleep(2500)

const playButtons = [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === '播放')
out['3_播放按钮数'] = playButtons.length

const results = []
for (let i = 0; i < playButtons.length; i += 1) {
  const buttons = [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === '播放')
  if (!buttons[i]) break
  buttons[i].click()

  const timeline = []
  for (let k = 0; k < 6; k += 1) {
    await sleep(1200)
    timeline.push(`${barText()} [${srcName()}]`)
  }
  results.push({
    第几首: i + 1,
    曲目: nowTitle(),
    错误: errText(),
    时间线: timeline,
    推进: timeline[timeline.length - 1] !== timeline[0]
  })
  await sleep(500)
}

out['4_逐个播放结果'] = results
return JSON.stringify(out, null, 1)
