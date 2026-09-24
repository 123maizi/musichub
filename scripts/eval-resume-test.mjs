/**
 * 专项：暂停 / 续传。
 * 用无损音质的大文件，并且一开跑就暂停，确保确实停在半路。
 */
const TEST_DIR = 'F:\\MusicHub\\.tmp\\dl-resume'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const auditOf = async (t) => (await window.api.download.audit())?.[t.id]

await window.api.download.setConfig({ dir: TEST_DIR })
const old = await window.api.download.list()
if (old.length) await window.api.download.remove(old.map((t) => t.id), false)

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

const [task] = await window.api.download.add({ songs: [song], quality: 'flac24bit' })

let paused = null
for (let i = 0; i < 600; i += 1) {
  await sleep(100)
  const t = (await window.api.download.list()).find((x) => x.id === task.id)
  if (t && t.status === 'downloading' && t.received > 0) {
    await window.api.download.pause([task.id])
    await sleep(700)
    paused = (await window.api.download.list()).find((x) => x.id === task.id)
    break
  }
  if (t && ['done', 'error'].includes(t.status)) {
    paused = t
    break
  }
}
out['B1_暂停时状态'] = paused?.status
out['B1_暂停时已下字节'] = paused?.received ?? null
out['B1_暂停时总量'] = paused?.total ?? null

if (paused && paused.status === 'paused') {
  await window.api.download.resume([task.id])
  let final = paused
  for (let i = 0; i < 300; i += 1) {
    await sleep(1000)
    final = (await window.api.download.list()).find((x) => x.id === task.id)
    if (final && ['done', 'error'].includes(final.status)) break
  }
  out['B2_续传后状态'] = final?.status
  out['B2_错误'] = final?.error ?? null
  out['B2_最终文件字节'] = (await auditOf(final))?.size ?? null
  out['B2_文件存在'] = (await auditOf(final))?.exists ?? null
  out['B2_确实从半路接着下'] = (final?.received ?? 0) > (paused.received ?? 0)
  out['B2_文件大小与总字节一致'] = (await auditOf(final))?.size === final?.total
}

window.location.hash = '#/downloads'
await sleep(2200)
const row = [...document.querySelectorAll('.task')][0]
const btn =
  row &&
  [...row.querySelectorAll('button')].find((b) => ['播放', '播放中'].includes(b.innerText.trim()))
if (btn) {
  btn.click()
  await sleep(4500)
  out['B3_播放'] = {
    时间: document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? '',
    音源: document.querySelector('.src-name')?.innerText?.trim() ?? '',
    出错: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 60) ?? ''
  }
}

return JSON.stringify(out, null, 1)
