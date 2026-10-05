/** 读音源页：每个音源的加载状态与可用平台 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rail = (l) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(l)
  )

rail('音源')?.click()
await sleep(4000)

// 等列表出现（脚本多，装载慢）
for (let i = 0; i < 40; i += 1) {
  await sleep(1500)
  if (document.querySelectorAll('[class*="source"] li, .src-item, .source-card, .card').length > 3) break
}

const out = { 页面标题: document.querySelector('.page-title, h1')?.textContent?.trim() ?? null }

// 通用做法：找出「名称 + 平台徽标」的可重复单元
const candidates = [
  '.source-list > *',
  '.src-list > *',
  '[class*="source"] > li',
  '.card',
  'li'
]
let items = []
let usedSel = ''
for (const sel of candidates) {
  const found = [...document.querySelectorAll(sel)].filter((e) => e.innerText && e.innerText.trim().length > 8)
  if (found.length >= 5) {
    items = found
    usedSel = sel
    break
  }
}
out.选择器 = usedSel
out.条目数 = items.length
out.前两条原文 = items.slice(0, 2).map((e) => e.innerText.replace(/\s+/g, ' ').trim().slice(0, 150))
out.全部条目 = items.map((e) => {
  const t = e.innerText.replace(/\s+/g, ' ').trim()
  const name = t.split(' ')[0].slice(0, 40)
  const failed = /失败|错误|无法|error|invalid|不支持/i.test(t)
  return (failed ? '✗ ' : '· ') + t.slice(0, 110)
})

// 页面全局统计（很多音源页会显示「已启用 N / 可用 M」）
out.页面统计文本 = [...document.querySelectorAll('*')]
  .map((e) => e.textContent ?? '')
  .filter((t) => /可用|已启用|音源.*\d|支持.*平台/i.test(t) && t.length < 120)
  .slice(0, 5)

return JSON.stringify(out, null, 1)
