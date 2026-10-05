/** 转储音源页的 DOM 结构，找到列表项的类名 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

const clicks = [...document.querySelectorAll('*')].filter(
  (e) => e.children.length === 0 && /^音源$/.test((e.textContent ?? '').trim())
)
if (clicks.length) clicks[clicks.length - 1].closest('button,a,li,div')?.click()
await sleep(4000)

// 找「文字里带 加载失败 / 可用」且子元素不多的容器
const all = [...document.querySelectorAll('*')]
const summary = all.find((e) => /可用 \/|加载失败/.test(e.textContent ?? '') && e.children.length < 12)
out.统计容器 = summary ? summary.className + ' :: ' + summary.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : null

// 收集所有出现多次的 class（列举项通常共享 class）
const counts = {}
for (const e of all) {
  if (typeof e.className !== 'string' || !e.className) continue
  for (const c of e.className.split(/\s+/).filter(Boolean)) counts[c] = (counts[c] ?? 0) + 1
}
out.高频类名 = Object.entries(counts)
  .filter(([, n]) => n >= 5 && n <= 60)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 22)
  .map(([c, n]) => c + ' x' + n)

// 逐个高频类名看第一个元素的文本，判断哪个是列表项
const detail = {}
for (const [c] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 18)) {
  const el = document.querySelector('.' + c.split(' ')[0])
  if (!el) continue
  const t = (el.innerText ?? '').replace(/\s+/g, ' ').trim()
  if (t.length > 4) detail[c] = t.slice(0, 90)
}
out.类名对应文本 = detail

return JSON.stringify(out, null, 1)
