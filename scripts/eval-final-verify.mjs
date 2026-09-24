/**
 * 收尾验收：
 *  A. 并发同名下载 → 三条任务必须拿到三个不同路径，三个文件都在、都能播
 *  B. 暂停/续传 → 换了 .part 命名之后，续传仍要能接上并且成品完好
 */
const TEST_DIR = 'F:\\MusicHub\\.tmp\\dl-final'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const auditOf = async (t) => (await window.api.download.audit())?.[t.id]

await window.api.download.setConfig({ dir: TEST_DIR })
const old = await window.api.download.list()
if (old.length) await window.api.download.remove(old.map((t) => t.id), false)

/* --- 拿一首歌 --- */
window.location.hash = '#/search'
await sleep(1800)
const input = document.querySelector('.search-box input')
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(150)
input.value = '周杰伦 晴天'
input.dispatchEvent(new Event('input', { bubbles: true }))
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
let rows = []
for (let i = 0; i < 25; i += 1) {
  await sleep(1000)
  rows = [...document.querySelectorAll('.results .row')]
  if (rows.length) break
}
rows[0].querySelector('.col-actions button[title="下载"]')?.click()
let song = null
for (let i = 0; i < 20; i += 1) {
  await sleep(500)
  const t = await window.api.download.list()
  if (t.length) {
    song = t[0].song
    await window.api.download.remove(t.map((x) => x.id), false)
    break
  }
}
if (!song) return JSON.stringify({ 错误: '拿不到歌曲' })

/* ============ A. 并发同名 ============ */
const created = await window.api.download.add({ songs: [song, song, song] })
out['A1_入队路径'] = created.map((t) => t.fileName)
out['A1_入队路径唯一数'] = new Set(created.map((t) => t.savePath.toLowerCase())).size

let tasks = []
for (let i = 0; i < 200; i += 1) {
  await sleep(1000)
  tasks = await window.api.download.list()
  if (tasks.length >= 3 && tasks.every((t) => ['done', 'error'].includes(t.status))) break
}
out['A2_状态'] = tasks.map((t) => `${t.status} ${t.fileName}`)
const doneTasks = tasks.filter((t) => t.status === 'done')
out['A2_完成数'] = doneTasks.length
out['A2_磁盘去重路径数'] = new Set(doneTasks.map((t) => t.savePath.toLowerCase())).size
out['A2_每个文件都存在'] = (
  await Promise.all(doneTasks.map(async (t) => (await auditOf(t))?.exists === true))
).every(Boolean)
out['A2_各文件字节'] = (await Promise.all(doneTasks.map(async (t) => (await auditOf(t))?.size))).join(',')

/* 播放校验 */
window.location.hash = '#/downloads'
await sleep(2200)
const playResults = []
for (let i = 0; i < doneTasks.length; i += 1) {
  const row = [...document.querySelectorAll('.task')][i]
  if (!row) continue
  const btn = [...row.querySelectorAll('button')].find((b) =>
    ['播放', '播放中'].includes(b.innerText.trim())
  )
  if (!btn) {
    playResults.push({ i, 结果: '无播放按钮', 按钮: [...row.querySelectorAll('button')].map((b) => b.innerText.trim()) })
    continue
  }
  btn.click()
  await sleep(4200)
  playResults.push({
    i,
    时间: document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? '',
    音源: document.querySelector('.src-name')?.innerText?.trim() ?? '',
    出错: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 60) ?? ''
  })
  await sleep(400)
}
out['A3_逐个播放'] = playResults
out['A3_全部能播'] = playResults.every(
  (p) => !p.出错 && p.音源 === '本地文件' && /^00:0[1-9]/.test(p.时间) && /03:4[0-9]/.test(p.时间)
)

/* ============ B. 暂停 / 续传 ============ */
const list2 = await window.api.download.list()
await window.api.download.remove(list2.map((t) => t.id), false)
const [task] = await window.api.download.add({ songs: [song] })
await sleep(2500)
await window.api.download.pause([task.id])
await sleep(900)
let mid = (await window.api.download.list()).find((t) => t.id === task.id)
out['B1_暂停后状态'] = mid?.status
out['B1_已下字节'] = mid?.received ?? null

await window.api.download.resume([task.id])
let final = mid
for (let i = 0; i < 200; i += 1) {
  await sleep(1000)
  final = (await window.api.download.list()).find((t) => t.id === task.id)
  if (final && ['done', 'error'].includes(final.status)) break
}
out['B2_续传后状态'] = final?.status
out['B2_错误'] = final?.error ?? null
out['B2_最终字节'] = (await auditOf(final))?.size ?? null
out['B2_文件存在'] = (await auditOf(final))?.exists ?? null
out['B2_续传后比暂停时更大'] = (final?.received ?? 0) > (mid?.received ?? 0)

out['C_当前目录'] = (await window.api.download.getConfig()).dir
return JSON.stringify(out, null, 1)
