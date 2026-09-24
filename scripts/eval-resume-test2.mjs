/**
 * 暂停/续传状态机：入队后立刻暂停（此时还是 waiting），再续传。
 *
 * 说明：这台机器上的音源把这个文件几百毫秒就灌完了，抓不到「正在下到一半」的
 * 时机，所以这里验证的是队列状态机与最终成品完整性；Range 续传那段逻辑本次
 * 没有改动（同一个 streamToFile），行为与改动前一致。
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
await window.api.download.pause([task.id])
await sleep(1200)
const afterPause = (await window.api.download.list()).find((t) => t.id === task.id)
out['1_暂停后状态'] = afterPause?.status

await window.api.download.resume([task.id])
let final = afterPause
for (let i = 0; i < 300; i += 1) {
  await sleep(700)
  final = (await window.api.download.list()).find((t) => t.id === task.id)
  if (final && ['done', 'error'].includes(final.status)) break
}
out['2_续传后状态'] = final?.status
out['3_错误'] = final?.error ?? null
out['4_文件存在'] = (await auditOf(final))?.exists ?? null
out['5_文件字节'] = (await auditOf(final))?.size ?? null
out['6_下载字节'] = final?.total ?? null
/*
 * 成品文件会比下载字节略大：写标签（封面图 + ID3/MP4 元数据）是要往文件里加东西的。
 * 所以判据是「不小于下载字节且差距合理（封面几十 KB）」，而不是相等。
 */
const fileBytes = (await auditOf(final))?.size ?? 0
const dlBytes = final?.total ?? 0
out['7_体积合理'] = fileBytes >= dlBytes && fileBytes - dlBytes < 512 * 1024
out['7_标签带来的增量'] = fileBytes - dlBytes
out['8_没有残留part'] = !(await window.api.download.list()).some((t) => t.savePath.includes('.part'))

window.location.hash = '#/downloads'
await sleep(2200)
const row = [...document.querySelectorAll('.task')][0]
const btn =
  row &&
  [...row.querySelectorAll('button')].find((b) => ['播放', '播放中'].includes(b.innerText.trim()))
if (btn) {
  btn.click()
  await sleep(4500)
  out['9_播放'] = {
    时间: document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? '',
    音源: document.querySelector('.src-name')?.innerText?.trim() ?? '',
    出错: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 60) ?? ''
  }
}

return JSON.stringify(out, null, 1)
