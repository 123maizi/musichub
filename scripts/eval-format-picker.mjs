/**
 * 验收下载格式选择器：
 *  1. 下载页有没有把格式直接摆出来、当前选中项对不对
 *  2. 点一下能不能真的改掉配置
 *  3. 搜索页工具条里有没有
 *  4. 按所选格式下载，任务行显示的是不是真实容器
 */
const TEST_DIR = 'F:\\MusicHub\\.tmp\\dl-fmt'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

const dumpPicker = () =>
  [...document.querySelectorAll('.fmt .opt')].map((b) => ({
    文本: b.innerText.replace(/\s+/g, ' ').trim(),
    选中: b.classList.contains('active')
  }))

/* 1. 下载页 */
window.location.hash = '#/downloads'
await sleep(2500)
out['1_配置里的格式'] = (await window.api.download.getConfig()).preferQuality
out['2_下载页格式按钮'] = dumpPicker()
out['3_说明文字'] = document.querySelector('.fmt .note')?.innerText?.trim() ?? '(无)'

/* 2. 点 MP3 320Kbps */
const mp3btn = [...document.querySelectorAll('.fmt .opt')].find((b) =>
  b.innerText.replace(/\s+/g, ' ').includes('320Kbps')
)
if (mp3btn) {
  mp3btn.click()
  await sleep(1200)
  out['4_点MP3_320后的配置'] = (await window.api.download.getConfig()).preferQuality
  out['5_点后选中的按钮'] = dumpPicker().filter((x) => x.选中).map((x) => x.文本)
} else {
  out['4_点MP3_320后的配置'] = '找不到 320Kbps 按钮'
}

/* 3. 搜索页工具条 */
window.location.hash = '#/search'
await sleep(2000)
out['6_搜索页格式按钮'] = dumpPicker()
const compact = document.querySelector('.fmt-inline .fmt.compact')
out['7_搜索页是紧凑模式'] = Boolean(compact)

/* 4. 按所选格式下载一首 */
await window.api.download.setConfig({ dir: TEST_DIR })
const old = await window.api.download.list()
if (old.length) await window.api.download.remove(old.map((t) => t.id), false)

const input = document.querySelector('.search-box input')
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(150)
input.value = '周杰伦 稻香'
input.dispatchEvent(new Event('input', { bubbles: true }))
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
let rows = []
for (let i = 0; i < 25; i += 1) {
  await sleep(1000)
  rows = [...document.querySelectorAll('.results .row')]
  if (rows.length) break
}
const dlBtn = rows[0]?.querySelector('.col-actions button[title^="下载为"]')
out['8_下载按钮提示'] = dlBtn?.getAttribute('title') ?? '(没有提示)'
dlBtn?.click()

let task = null
for (let i = 0; i < 30; i += 1) {
  await sleep(700)
  const all = await window.api.download.list()
  if (all.length) {
    task = all[0]
    break
  }
}
if (!task) {
  out['9_下载'] = '没入队'
  return JSON.stringify(out, null, 1)
}
for (let i = 0; i < 150; i += 1) {
  await sleep(1000)
  task = (await window.api.download.list()).find((t) => t.id === task.id)
  if (task && ['done', 'error'].includes(task.status)) break
}
out['9_下载结果'] = {
  文件: task.fileName,
  状态: task.status,
  请求档位: task.quality,
  音源实给: task.actualQuality ?? null,
  错误: task.error ?? null
}

/* 5. 任务行显示的标签 */
window.location.hash = '#/downloads'
await sleep(2500)
out['10_任务行文本'] = document.querySelector('.task .line1')?.innerText?.replace(/\s+/g, ' ').trim() ?? '(空)'

await window.api.download.setConfig({ dir: 'C:\\Users\\18509\\Desktop\\歌曲下载' })
await sleep(500)
out['11_已还原目录'] = (await window.api.download.getConfig()).dir
out['12_格式已还原为'] = (await window.api.download.getConfig()).preferQuality

return JSON.stringify(out, null, 1)
