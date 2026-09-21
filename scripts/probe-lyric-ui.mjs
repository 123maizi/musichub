/**
 * 真实 UI 流程验证：
 *   搜索 → 播放 → 翻译 → 切走 → 切回来（译文还在？）→ 修改译文 → 保存
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const text = (s) => document.querySelector(s)?.innerText?.replace(/\s+/g, ' ').trim() ?? ''
const out = {}

/* ---------- 1. 搜一首英文歌并播放 ---------- */
window.location.hash = '#/search'
await sleep(2000)
const input = document.querySelector('.search-box input')
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(200)
input.value = 'The Sound of Silence'
input.dispatchEvent(new Event('input', { bubbles: true }))
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))

let rows = 0
for (let i = 0; i < 20; i += 1) {
  await sleep(1000)
  rows = document.querySelectorAll('.results .row').length
  if (rows > 0) break
}
out['1_搜索结果'] = rows

const first = document.querySelector('.results .row')
out['2_首条'] = first?.innerText?.replace(/\s+/g, ' ').slice(0, 60)
first.querySelector('.col-actions button[title="播放"]').click()

/* ---------- 2. 等歌词加载 ---------- */
window.location.hash = '#/now-playing'
await sleep(3000)
let lyricCount = 0
for (let i = 0; i < 20; i += 1) {
  await sleep(1000)
  lyricCount = document.querySelectorAll('.lyric-line').length
  if (lyricCount > 2) break
}
out['3_歌词行数'] = lyricCount
out['4_曲目'] = text('.meta h1')

/* ---------- 3. 点翻译 ---------- */
const trBtn = [...document.querySelectorAll('.translate-btn')].find((b) =>
  /翻译歌词|隐藏译文|翻译中/.test(b.innerText)
)
out['5_翻译按钮'] = trBtn?.innerText?.trim()
if (!trBtn) return JSON.stringify(out, null, 1)
trBtn.click()

let transCount = 0
for (let i = 0; i < 60; i += 1) {
  await sleep(1000)
  transCount = document.querySelectorAll('.lyric-trans').length
  if (transCount > 0) break
}
await sleep(1500)
out['6_译文行数'] = transCount
out['7_来源标签'] = text('.translate-note')
out['8_译文样例'] = [...document.querySelectorAll('.lyric-trans')]
  .slice(0, 3)
  .map((e) => e.innerText.trim())

/* ---------- 4. 切走再切回来 ---------- */
window.location.hash = '#/search'
await sleep(2500)
window.location.hash = '#/now-playing'
await sleep(3500)

let restored = 0
for (let i = 0; i < 15; i += 1) {
  await sleep(1000)
  restored = document.querySelectorAll('.lyric-trans').length
  if (restored > 0) break
}
out['9_切回来后译文行数'] = restored
out['10_切回来后标签'] = text('.translate-note')

/* ---------- 5. 修改译文 ---------- */
const editBtn = [...document.querySelectorAll('.translate-btn')].find((b) =>
  /修改译文|添加译文/.test(b.innerText)
)
out['11_编辑按钮'] = editBtn?.innerText?.trim()
editBtn?.click()
await sleep(1200)

const inputs = [...document.querySelectorAll('.editor-input')]
out['12_编辑框数量'] = inputs.length
if (inputs.length > 0) {
  inputs[0].value = '【我改的】黑暗啊，我的老朋友'
  inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(300)
}

const saveBtn = [...document.querySelectorAll('.editor-foot button')].find((b) =>
  /保存译文/.test(b.innerText)
)
saveBtn?.click()
await sleep(2500)

out['13_保存后标签'] = text('.translate-note')
out['14_保存后首行译文'] = document.querySelector('.lyric-trans')?.innerText?.trim()
out['15_编辑器已关闭'] = document.querySelectorAll('.editor-input').length === 0

/* ---------- 6. 再切走切回，确认手工修改被保留 ---------- */
window.location.hash = '#/search'
await sleep(2500)
window.location.hash = '#/now-playing'
await sleep(4000)
out['16_再切回来后首行译文'] = document.querySelector('.lyric-trans')?.innerText?.trim()
out['17_再切回来后标签'] = text('.translate-note')

return JSON.stringify(out, null, 1)
