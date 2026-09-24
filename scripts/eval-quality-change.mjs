/**
 * 复现：改「默认播放音质」之后，再下载同一首歌会不会失效。
 *
 * 走的是用户真实路径：设置页改音质 → 搜索页下载 → 到下载页点播放。
 */
const TEST_DIR = 'F:\\MusicHub\\.tmp\\dl-quality'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const auditOf = async (t) => (await window.api.download.audit())?.[t.id]

async function setPlayQuality(q) {
  window.location.hash = '#/settings'
  await sleep(1500)
  const field = [...document.querySelectorAll('.field')].find((f) =>
    (f.querySelector('label')?.innerText ?? '').includes('默认播放音质')
  )
  if (!field) return '找不到默认播放音质控件'
  const sel = field.querySelector('select')
  sel.value = q
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(1200)
  return sel.value
}

async function searchSong(keyword) {
  window.location.hash = '#/search'
  await sleep(1800)
  const input = document.querySelector('.search-box input')
  input.focus()
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(150)
  input.value = keyword
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    const rows = [...document.querySelectorAll('.results .row')]
    if (rows.length) return rows
  }
  return []
}

async function waitDone(ids, ms = 180000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    await sleep(1000)
    const all = await window.api.download.list()
    const mine = all.filter((t) => ids.includes(t.id))
    if (mine.length === ids.length && mine.every((t) => ['done', 'error'].includes(t.status))) {
      return mine
    }
  }
  return (await window.api.download.list()).filter((t) => ids.includes(t.id))
}

/** 到下载页点第 idx 行的播放按钮 */
async function playRow(idx) {
  window.location.hash = '#/downloads'
  await sleep(2200)
  const row = [...document.querySelectorAll('.task')][idx]
  if (!row) return { 结果: '没有这一行' }
  const btn = [...row.querySelectorAll('button')].find((b) =>
    ['播放', '播放中', '重新下载'].includes(b.innerText.trim())
  )
  if (!btn) return { 结果: '没有播放按钮', 按钮: [...row.querySelectorAll('button')].map((b) => b.innerText.trim()) }
  if (btn.innerText.trim() === '重新下载') return { 结果: '被标记为文件已丢失' }
  btn.click()
  await sleep(4500)
  return {
    时间: document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? '',
    音源: document.querySelector('.src-name')?.innerText?.trim() ?? '',
    出错: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 80) ?? ''
  }
}

await window.api.download.setConfig({ dir: TEST_DIR })
const old = await window.api.download.list()
if (old.length) await window.api.download.remove(old.map((t) => t.id), false)

/* ---------- 第一轮：音质 320k ---------- */
out['1_改成320k'] = await setPlayQuality('320k')
let rows = await searchSong('周杰伦 晴天')
if (!rows.length) return JSON.stringify({ 错误: '搜索无结果' })
rows[0].querySelector('.col-actions button[title="下载"]')?.click()
await sleep(1200)
let first = (await window.api.download.list()).slice(0, 1)
if (!first.length) return JSON.stringify({ 错误: '第一次入队失败' })
first = await waitDone([first[0].id])
out['2_第一次下载'] = first.map((t) => ({
  文件: t.fileName,
  音质: t.quality,
  状态: t.status,
  错误: t.error ?? null,
  字节: null
}))
out['2_第一次文件存在'] = (await auditOf(first[0]))?.exists ?? null
out['2_第一次播放'] = await playRow(0)

/* ---------- 改音质 ---------- */
out['3_改成flac24bit'] = await setPlayQuality('flac24bit')

/* ---------- 第二轮：同一首歌再下一次 ---------- */
rows = await searchSong('周杰伦 晴天')
if (!rows.length) return JSON.stringify({ 错误: '第二轮搜索无结果' })
rows[0].querySelector('.col-actions button[title="下载"]')?.click()
await sleep(1200)
const all2 = await window.api.download.list()
const knownIds = new Set(first.map((t) => t.id))
const second = all2.filter((t) => !knownIds.has(t.id))
if (!second.length) {
  out['4_第二次入队'] = '没有新任务'
} else {
  const done2 = await waitDone(second.map((t) => t.id))
  out['4_第二次下载'] = done2.map((t) => ({
    文件: t.fileName,
    音质: t.quality,
    状态: t.status,
    错误: t.error ?? null
  }))
  out['4_第二次文件存在'] = (await auditOf(done2[0]))?.exists ?? null
  out['4_第二次播放'] = await playRow(0)
}

out['5_当前播放音质下拉'] = (() => {
  const f = [...document.querySelectorAll('.field')].find((x) =>
    (x.querySelector('label')?.innerText ?? '').includes('默认播放音质')
  )
  return f?.querySelector('select')?.value ?? null
})()

return JSON.stringify(out, null, 1)
