/**
 * 现场复现：全新下载一首歌，然后立刻播放。
 * 全程走真实链路（下载 → 落盘 → 下载页点播放 → 音频元素加载）。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const out = {}

/* 0. 记录当前配置 */
const cfg = await window.api.download.getConfig()
out['0_配置'] = { 目录: cfg.dir, 写标签: cfg.writeTag, 下封面: cfg.downloadCover }

/* 1. 清掉旧任务（**不删文件**，避免误删） */
const existing = await window.api.download.list()
if (existing.length > 0) {
  await window.api.download.remove(existing.map((t) => t.id), false)
  out['1_清理旧任务'] = `移除 ${existing.length} 条（保留文件）`
}

/* 2. 搜一首歌并下载 */
window.location.hash = '#/search'
await sleep(2000)
const input = document.querySelector('.search-box input')
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(200)
input.value = '周杰伦 稻香'
input.dispatchEvent(new Event('input', { bubbles: true }))
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))

let rows = 0
for (let i = 0; i < 20; i += 1) {
  await sleep(1000)
  rows = document.querySelectorAll('.results .row').length
  if (rows > 0) break
}
const firstRow = document.querySelector('.results .row')
out['2_选中'] = firstRow?.innerText?.replace(/\s+/g, ' ').slice(0, 60)

const dlBtn = firstRow?.querySelector('.col-actions button[title="下载"]')
if (!dlBtn) {
  out['2_选中'] = '找不到下载按钮'
  return JSON.stringify(out, null, 1)
}
dlBtn.click()

/* 3. 等下载完成 */
let task = null
for (let i = 0; i < 90; i += 1) {
  await sleep(1000)
  const list = await window.api.download.list()
  const t = list[0]
  if (t && (t.status === 'done' || t.status === 'error')) {
    task = t
    break
  }
}
out['3_下载结果'] = task
  ? { 状态: task.status, 文件: task.fileName, 路径: task.savePath, 错误: task.error ?? null }
  : { 状态: '超时' }

if (!task || task.status !== 'done') return JSON.stringify(out, null, 1)

/* 4. 立刻取流并播放（跟下载页点播放走的是同一条路） */
const song = {
  ...task.song,
  id: 'local_' + task.savePath,
  platform: 'local',
  songmid: task.savePath,
  localPath: task.savePath
}

try {
  const r = await window.api.player.getUrl({ song })
  out['4_取流'] = String(r.url).slice(0, 60) + '…'
  const probe = await window.api.player.probe(String(r.url))
  out['5_代理探活'] = `${probe.ok ? 'OK' : '失败'} HTTP ${probe.status} ${probe.size ? Math.round(probe.size / 1024) + 'KB' : '无长度'} ${probe.contentType ?? ''}`

  out['6_音频加载'] = await new Promise((resolve) => {
    const a = document.createElement('audio')
    a.preload = 'metadata'
    const t = setTimeout(() => resolve('✗ 超时'), 10000)
    a.onloadedmetadata = () => {
      clearTimeout(t)
      resolve(`✓ ${Math.round(a.duration)} 秒 readyState=${a.readyState}`)
    }
    a.onerror = () => {
      clearTimeout(t)
      resolve(`✗ 错误码 ${a.error?.code}`)
    }
    a.src = String(r.url)
  })
} catch (err) {
  out['4_取流'] = '✗ ' + String(err.message).replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 60)
}

return JSON.stringify(out, null, 1)
