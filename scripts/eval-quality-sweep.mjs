/**
 * 音质遍历：把 5 档音质逐个丢进下载管线，看哪一档会产出「听不了」的文件。
 *
 * 「默认播放音质」之所以会牵连下载，是因为播放条上的下载按钮把 player.quality
 * 直接当成下载音质传了下去 —— 于是改播放音质 = 改下载音质。
 */
const TEST_DIR = 'F:\\MusicHub\\.tmp\\dl-sweep'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const auditOf = async (t) => (await window.api.download.audit())?.[t.id]
const QUALITIES = ['flac24bit', 'hires', 'flac', '320k', '128k']

await window.api.download.setConfig({ dir: TEST_DIR })
const old = await window.api.download.list()
if (old.length) await window.api.download.remove(old.map((t) => t.id), false)

/* 取一首歌 */
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
out['歌曲声明音质'] = song.qualities ?? []

/* 逐档下载 */
const ids = []
for (const q of QUALITIES) {
  const [t] = await window.api.download.add({ songs: [song], quality: q })
  ids.push(t.id)
}
out['已入队'] = ids.length

const deadline = Date.now() + 240000
let tasks = []
for (;;) {
  await sleep(1000)
  tasks = (await window.api.download.list()).filter((t) => ids.includes(t.id))
  if (tasks.length === ids.length && tasks.every((t) => ['done', 'error'].includes(t.status))) break
  if (Date.now() > deadline) break
}

const audit = await window.api.download.audit()
out['结果'] = []
for (let i = 0; i < QUALITIES.length; i += 1) {
  const t = tasks.find((x) => x.id === ids[i])
  out['结果'].push({
    请求音质: QUALITIES[i],
    实际音质: t?.quality ?? null,
    文件: t?.fileName ?? null,
    状态: t?.status ?? null,
    错误: t?.error ?? null,
    文件存在: t ? (audit?.[t.id]?.exists ?? null) : null,
    字节: t ? (audit?.[t.id]?.size ?? null) : null
  })
}

/* 逐个播 */
window.location.hash = '#/downloads'
await sleep(2200)
const plays = []
for (const q of QUALITIES) {
  const idx = tasks.findIndex((x) => x.id === ids[QUALITIES.indexOf(q)])
  const row = [...document.querySelectorAll('.task')][idx]
  if (!row) {
    plays.push({ 请求音质: q, 结果: '没有这一行' })
    continue
  }
  const btn = [...row.querySelectorAll('button')].find((b) =>
    ['播放', '播放中', '重新下载'].includes(b.innerText.trim())
  )
  const label = btn?.innerText.trim()
  if (label === '重新下载') {
    plays.push({ 请求音质: q, 结果: '界面判定：文件已丢失' })
    continue
  }
  if (!btn) {
    plays.push({ 请求音质: q, 结果: '没有播放按钮' })
    continue
  }
  btn.click()
  await sleep(4500)
  plays.push({
    请求音质: q,
    文件: tasks[idx]?.fileName ?? null,
    时间: document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? '',
    音源: document.querySelector('.src-name')?.innerText?.trim() ?? '',
    出错: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 80) ?? ''
  })
  await sleep(400)
}
out['逐个播放'] = plays

return JSON.stringify(out, null, 1)
