/**
 * 把「切歌」的所有方式都测一遍，找出哪一种还有残留。
 * 场景：① 双击行  ② 快速连点三首  ③ 暂停中切歌  ④ 从队列下一首
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const rail = (l) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(l)
  )
const rows = () => [...document.querySelectorAll('.results .row')]
const pct = (sel) => {
  const el = document.querySelector(sel)
  if (!el) return null
  const m = /matrix\(([-\d.]+)/.exec(getComputedStyle(el).transform)
  return m ? Math.round(Number(m[1]) * 1000) / 10 : null
}
const title = () => (document.querySelector('.player-bar .now-title')?.textContent ?? '').trim().slice(0, 10)

const sample = async (ms = 3000, step = 50) => {
  const line = []
  for (let i = 0; i < ms / step; i += 1) {
    await sleep(step)
    line.push(pct('.progress-fill'))
  }
  return line
}

rail('搜索')?.click()
await sleep(2200)
if (rows().length === 0) {
  const inp = document.querySelector('.search-box input')
  inp.focus()
  inp.value = '周杰伦'
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(300)
  inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    if (rows().length > 0) break
  }
}
const list = rows()

/* 先播一首并等到进度可观，作为每种场景的共同前置 */
const warm = async () => {
  list[0]?.querySelector('.col-actions button[title="播放"]')?.click()
  await sleep(12000)
  return pct('.progress-fill')
}

/* ① 双击行切歌 */
let before = await warm()
list[1]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
const l1 = await sample()
out['①双击切歌'] = { 切歌前: before, 前1_5秒最大: Math.max(...l1.slice(0, 30).map((v) => v ?? 0)), 曲目: title() }

/* ② 快速连点三首（每次间隔 400ms，模拟手快） */
before = pct('.progress-fill')
list[2]?.querySelector('.col-actions button[title="播放"]')?.click()
await sleep(400)
list[3]?.querySelector('.col-actions button[title="播放"]')?.click()
await sleep(400)
list[4]?.querySelector('.col-actions button[title="播放"]')?.click()
const l2 = await sample()
out['②快速连点'] = {
  第一次点击前: before,
  前1_5秒最大: Math.max(...l2.slice(0, 30).map((v) => v ?? 0)),
  全程最大: Math.max(...l2.map((v) => v ?? 0)),
  曲目: title()
}

/* ③ 暂停中切歌 */
await sleep(6000)
const pauseBtn = [...document.querySelectorAll('footer.player-bar button')].find((b) =>
  /暂停/.test(b.getAttribute('title') ?? '')
)
pauseBtn?.click()
await sleep(1200)
before = pct('.progress-fill')
out['③暂停中切歌_前'] = { 进度: before, 找到暂停按钮: !!pauseBtn }
list[5]?.querySelector('.col-actions button[title="播放"]')?.click()
const l3 = await sample()
out['③暂停中切歌'] = { 切歌前: before, 前1_5秒最大: Math.max(...l3.slice(0, 30).map((v) => v ?? 0)), 曲目: title() }

/* ④ 从播放条「下一首」切 */
await sleep(8000)
before = pct('.progress-fill')
const nextBtn = [...document.querySelectorAll('footer.player-bar button')].find((b) =>
  /下一首/.test(b.getAttribute('title') ?? '')
)
nextBtn?.click()
const l4 = await sample()
out['④下一首切歌'] = { 切歌前: before, 前1_5秒最大: Math.max(...l4.slice(0, 30).map((v) => v ?? 0)), 曲目: title() }

out.汇总 = Object.entries(out)
  .filter(([k, v]) => v && typeof v === 'object' && '前1_5秒最大' in v)
  .map(([k, v]) => ({ 场景: k, 切歌前: v.切歌前 ?? v.第一次点击前, 前1_5秒最大: v.前1_5秒最大, 判定: v.前1_5秒最大 <= 1.5 ? '✓' : '★ 有残留' }))

return JSON.stringify(out, null, 1)
