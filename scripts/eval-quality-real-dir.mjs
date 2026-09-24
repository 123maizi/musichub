/**
 * 用「真实目录结构」复现：沙盒里预先放好用户已有的同名文件，
 * 然后改音质再下一次，看老文件会不会被顶掉、新文件能不能播。
 *
 * 关键怀疑点：planPath 规划时扩展名硬编码 .mp3，而真实容器要等取流后才知道。
 * 于是「这个名字有没有被占用」是在错误的扩展名下判断的，最终落盘时可能压在已有文件上。
 */
const TEST_DIR = 'F:\\MusicHub\\.tmp\\dl-real'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const auditOf = async (t) => (await window.api.download.audit())?.[t.id]

async function setDownloadQuality(q) {
  window.location.hash = '#/settings'
  await sleep(1600)
  const field = [...document.querySelectorAll('.field')].find((f) =>
    (f.querySelector('label')?.innerText ?? '').includes('首选音质')
  )
  if (!field) return '找不到首选音质控件'
  const sel = field.querySelector('select')
  const before = sel.value
  sel.value = q
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(1200)
  return `${before} → ${sel.value}`
}

async function searchAndDownloadFirstRow() {
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
  if (!rows.length) return null
  const before = await window.api.download.list()
  rows[0].querySelector('.col-actions button[title="下载"]')?.click()
  await sleep(1500)
  const after = await window.api.download.list()
  const known = new Set(before.map((t) => t.id))
  let created = after.filter((t) => !known.has(t.id))
  if (!created.length) return null
  const deadline = Date.now() + 150000
  for (;;) {
    await sleep(1000)
    const all = await window.api.download.list()
    created = all.filter((t) => created.some((c) => c.id === t.id))
    if (created.every((t) => ['done', 'error'].includes(t.status))) break
    if (Date.now() > deadline) break
  }
  return created[0]
}

await window.api.download.setConfig({ dir: TEST_DIR })
const old = await window.api.download.list()
if (old.length) await window.api.download.remove(old.map((t) => t.id), false)

out['0_改首选音质为128k'] = await setDownloadQuality('128k')

/* ---- 第一轮：下到沙盒（此时沙盒里已预置了同名 .flac） ---- */
const t1 = await searchAndDownloadFirstRow()
out['1_第一轮'] = t1
  ? { 文件: t1.fileName, 状态: t1.status, 错误: t1.error ?? null, 字节: (await auditOf(t1))?.size ?? null }
  : '没入队'

/* ---- 改音质 ---- */
out['2_改首选音质为flac24bit'] = await setDownloadQuality('flac24bit')

/* ---- 第二轮：同一首歌再下一次 ---- */
const t2 = await searchAndDownloadFirstRow()
out['3_第二轮'] = t2
  ? { 文件: t2.fileName, 状态: t2.status, 错误: t2.error ?? null, 字节: (await auditOf(t2))?.size ?? null }
  : '没入队'

/* ---- 再改回 320k，第三轮 ---- */
out['4_改首选音质为320k'] = await setDownloadQuality('320k')
const t3 = await searchAndDownloadFirstRow()
out['5_第三轮'] = t3
  ? { 文件: t3.fileName, 状态: t3.status, 错误: t3.error ?? null, 字节: (await auditOf(t3))?.size ?? null }
  : '没入队'

/* ---- 全部任务的路径与存在性 ---- */
const tasks = await window.api.download.list()
const audit = await window.api.download.audit()
out['6_任务路径'] = tasks.map((t) => ({
  文件: t.fileName,
  状态: t.status,
  存在: audit?.[t.id]?.exists ?? null,
  字节: audit?.[t.id]?.size ?? null
}))
out['6_路径去重数'] = new Set(tasks.map((t) => t.savePath.toLowerCase())).size
out['6_任务数'] = tasks.length

/* ---- 逐个播 ---- */
window.location.hash = '#/downloads'
await sleep(2400)
const plays = []
const list = await window.api.download.list()
for (let i = 0; i < list.length; i += 1) {
  const row = [...document.querySelectorAll('.task')][i]
  if (!row) continue
  const btn = [...row.querySelectorAll('button')].find((b) =>
    ['播放', '播放中', '重新下载'].includes(b.innerText.trim())
  )
  if (!btn) {
    plays.push({ i, 文件: list[i].fileName, 结果: '没有播放按钮' })
    continue
  }
  if (btn.innerText.trim() === '重新下载') {
    plays.push({ i, 文件: list[i].fileName, 结果: '界面判定：文件已丢失' })
    continue
  }
  btn.click()
  await sleep(4500)
  plays.push({
    i,
    文件: list[i].fileName,
    时间: document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? '',
    音源: document.querySelector('.src-name')?.innerText?.trim() ?? '',
    出错: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 70) ?? ''
  })
  await sleep(400)
}
out['7_逐个播放'] = plays

return JSON.stringify(out, null, 1)
