/**
 * 精确复现：先播放一首歌 → 到设置页改「默认播放音质」→ 用播放条上的下载按钮下载。
 *
 * 这是唯一会把「播放音质」带进「下载」的路径：播放条的下载按钮传的是 player.quality。
 */
const TEST_DIR = 'F:\\MusicHub\\.tmp\\dl-playerpath'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const auditOf = async (t) => (await window.api.download.audit())?.[t.id]

async function setPlayQuality(q) {
  window.location.hash = '#/settings'
  await sleep(1600)
  const field = [...document.querySelectorAll('.field')].find((f) =>
    (f.querySelector('label')?.innerText ?? '').includes('默认播放音质')
  )
  if (!field) return '找不到控件'
  const sel = field.querySelector('select')
  const before = sel.value
  sel.value = q
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(1400)
  out[`音质_${q}_下拉`] = `${before} → ${sel.value}`
  return sel.value
}

await window.api.download.setConfig({ dir: TEST_DIR })
const old = await window.api.download.list()
if (old.length) await window.api.download.remove(old.map((t) => t.id), false)

/* --- 搜索并播放第一首 --- */
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
rows[0].querySelector('.col-actions button[title="播放"]')?.click()
await sleep(5000)
out['1_正在播放'] = {
  曲名: document.querySelector('.now-title')?.innerText?.trim() ?? '',
  音质标签: document.querySelector('.quality')?.innerText?.trim() ?? '',
  时间: document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? '',
  出错: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 60) ?? ''
}

/* --- 改播放音质（每改一次就下一条） --- */
const results = []
for (const q of ['flac24bit', '128k', 'flac']) {
  await setPlayQuality(q)
  await sleep(2500)

  /* 回到搜索页，用播放条的下载按钮 */
  window.location.hash = '#/search'
  await sleep(1500)
  const before = await window.api.download.list()
  const barBtn = [...document.querySelectorAll('.player-bar button')].find((b) =>
    /下载/.test(b.getAttribute('title') ?? '') || /下载/.test(b.innerText)
  )
  if (!barBtn) {
    results.push({ 音质: q, 结果: '播放条上找不到下载按钮', 按钮: [...document.querySelectorAll('.player-bar button')].map((b) => b.getAttribute('title') ?? b.innerText.trim()) })
    continue
  }
  barBtn.click()
  await sleep(1500)
  const after = await window.api.download.list()
  const known = new Set(before.map((t) => t.id))
  let created = after.filter((t) => !known.has(t.id))
  if (!created.length) {
    results.push({ 音质: q, 结果: '点了下载但没入队' })
    continue
  }
  const deadline = Date.now() + 120000
  for (;;) {
    await sleep(1000)
    const all = await window.api.download.list()
    created = all.filter((t) => created.some((c) => c.id === t.id))
    if (created.every((t) => ['done', 'error'].includes(t.status))) break
    if (Date.now() > deadline) break
  }
  const t = created[0]
  results.push({
    音质: q,
    文件: t.fileName,
    任务音质: t.quality,
    状态: t.status,
    错误: t.error ?? null,
    文件存在: (await auditOf(t))?.exists ?? null,
    字节: (await auditOf(t))?.size ?? null
  })
}
out['2_音质×下载'] = results

/* --- 逐个播 --- */
window.location.hash = '#/downloads'
await sleep(2400)
const allTasks = await window.api.download.list()
const plays = []
for (let i = 0; i < allTasks.length; i += 1) {
  const row = [...document.querySelectorAll('.task')][i]
  if (!row) continue
  const btn = [...row.querySelectorAll('button')].find((b) =>
    ['播放', '播放中', '重新下载'].includes(b.innerText.trim())
  )
  const label = btn?.innerText.trim()
  if (!btn) {
    plays.push({ i, 结果: '没有按钮' })
    continue
  }
  if (label === '重新下载') {
    plays.push({ i, 文件: allTasks[i].fileName, 结果: '界面判定：文件已丢失' })
    continue
  }
  btn.click()
  await sleep(4500)
  plays.push({
    i,
    文件: allTasks[i].fileName,
    任务音质: allTasks[i].quality,
    时间: document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? '',
    音源: document.querySelector('.src-name')?.innerText?.trim() ?? '',
    出错: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 70) ?? ''
  })
  await sleep(400)
}
out['3_逐个播放'] = plays

return JSON.stringify(out, null, 1)
