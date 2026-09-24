/**
 * 并发同名下载回归测试。
 *
 * 复现条件：同一首歌连续加入 3 次 → 文件名基名完全相同。
 * 修复前的表现：3 条任务的 savePath 一模一样，磁盘上只留 1 个文件。
 * 修复后的预期：3 条任务拿到 3 个不同路径，磁盘上 3 个文件都在、都能播。
 */
const TEST_DIR = 'F:\\MusicHub\\.tmp\\dl-concurrency'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

/* 0. 记录原目录，方便事后还原 */
const oldCfg = await window.api.download.getConfig()
out['0_原下载目录'] = oldCfg.dir

/* 1. 清空任务记录（不删文件），切到沙盒目录 */
const old = await window.api.download.list()
if (old.length) await window.api.download.remove(old.map((t) => t.id), false)
await window.api.download.setConfig({ dir: TEST_DIR })

/* 2. 搜一首歌，拿第一条结果重复入队 3 次 */
window.location.hash = '#/search'
await sleep(1800)
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
  if (rows.length > 0) break
}
if (!rows.length) return JSON.stringify({ 错误: '搜索没出结果' })

/* 直接走 IPC，把同一首歌加 3 遍 —— 强制制造同名 */
const songs = window.__probeSongs ?? null
let song = songs?.[0]
if (!song) {
  /* 从搜索结果里抠出歌曲对象：点第一行的「下载」再读任务 */
  rows[0].querySelector('.col-actions button[title="下载"]')?.click()
  for (let i = 0; i < 20; i += 1) {
    await sleep(500)
    const t = await window.api.download.list()
    if (t.length) {
      song = t[0].song
      await window.api.download.remove(t.map((x) => x.id), false)
      break
    }
  }
}
if (!song) return JSON.stringify({ 错误: '拿不到歌曲对象' })
out['1_测试歌曲'] = `${song.name} - ${song.singer}`

/* 3. 同一首歌连加 3 次 */
const created = await window.api.download.add({ songs: [song, song, song] })
out['2_入队任务数'] = created.length
out['2_入队时路径'] = created.map((t) => t.fileName)
out['2_入队路径是否互不相同'] = new Set(created.map((t) => t.savePath.toLowerCase())).size

/* 4. 等全部到终态 */
let tasks = []
for (let i = 0; i < 180; i += 1) {
  await sleep(1000)
  tasks = await window.api.download.list()
  if (tasks.length >= 3 && tasks.every((t) => ['done', 'error', 'cancelled'].includes(t.status))) break
}
out['3_最终状态'] = tasks.map((t) => ({ 文件: t.fileName, 状态: t.status, 错误: t.error ?? null }))
out['3_完成数'] = tasks.filter((t) => t.status === 'done').length
out['3_文件路径去重后数量'] = new Set(tasks.map((t) => t.savePath.toLowerCase())).size

/* 5. 磁盘体检：每个 done 任务的文件是否真在 */
const audit = await window.api.download.audit()
out['4_磁盘体检'] = tasks
  .filter((t) => t.status === 'done')
  .map((t) => ({
    文件: t.fileName,
    存在: audit?.[t.id]?.exists ?? null,
    字节: audit?.[t.id]?.size ?? null
  }))
out['4_全部文件都在'] = tasks
  .filter((t) => t.status === 'done')
  .every((t) => audit?.[t.id]?.exists === true)

/* 6. 逐个点播放，确认真的能出声 */
window.location.hash = '#/downloads'
await sleep(2000)

const played = []
const doneTasks = tasks.filter((t) => t.status === 'done')
for (const t of doneTasks) {
  const row = [...document.querySelectorAll('.row')].find((r) =>
    r.innerText.includes(t.fileName)
  )
  if (!row) {
    played.push({ 文件: t.fileName, 结果: '找不到行' })
    continue
  }
  const btn = [...row.querySelectorAll('button')].find((b) => b.innerText.trim() === '播放')
  if (!btn) {
    played.push({ 文件: t.fileName, 结果: '没有播放按钮（可能已被标记文件丢失）' })
    continue
  }
  btn.click()
  await sleep(3500)
  const el = document.querySelector('audio')
  played.push({
    文件: t.fileName,
    曲名: document.querySelector('.now-title')?.innerText?.trim() ?? '',
    进度: document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? '',
    readyState: el?.readyState ?? null,
    时长秒: el?.duration ? Math.round(el.duration) : null,
    出错: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 70) ?? ''
  })
  await sleep(300)
}
out['5_逐个播放'] = played

/* 7. 还原目录配置 */
await window.api.download.setConfig({ dir: oldCfg.dir })
out['6_已还原目录'] = (await window.api.download.getConfig()).dir

return JSON.stringify(out, null, 1)
