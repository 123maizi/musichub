/**
 * 重启后下载记录是否还在，以及能不能直接播放。
 * 用法：重启应用后运行本探针。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

window.location.hash = '#/downloads'
await sleep(3000)

const text = () => document.body.innerText.replace(/\s+/g, ' ')
const timeRow = () => document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? ''

const taskCount = (text().match(/下载\s*(\d+)\s*个任务/) || [])[1] ?? '?'
const hasEmpty = text().includes('还没有下载任务')
const state = text().slice(-330)

const playBtn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '播放')

if (!playBtn) {
  return JSON.stringify({ 任务数: taskCount, 空列表: hasEmpty, 状态: state }, null, 1)
}

playBtn.click()
const timeline = []
for (let i = 0; i < 8; i += 1) {
  await sleep(1000)
  timeline.push(`${timeRow()}  [${document.querySelector('.src-name')?.innerText ?? ''}]`)
}

return JSON.stringify(
  {
    任务数: taskCount,
    空列表: hasEmpty,
    曲目: document.querySelector('.now-title')?.innerText ?? '',
    播放时间线: timeline,
    错误: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 80) ?? ''
  },
  null,
  1
)
