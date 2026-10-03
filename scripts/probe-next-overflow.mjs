/**
 * 专攻「下一首」切歌时出现的 748% 异常值。
 * 同时记录 --p 的实际值、填充的 scaleX、以及 store 侧的时间读数。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const rail = (l) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(l)
  )
const rows = () => [...document.querySelectorAll('.results .row')]

const snap = () => {
  const railEl = document.querySelector('.progress-rail')
  const fill = document.querySelector('.progress-fill')
  const p = railEl ? getComputedStyle(railEl).getPropertyValue('--p').trim() : null
  const m = fill ? /matrix\(([-\d.]+)/.exec(getComputedStyle(fill).transform) : null
  return {
    p: p === '' ? null : p,
    scale: m ? Number(m[1]) : null,
    title: (document.querySelector('.player-bar .now-title')?.textContent ?? '').trim().slice(0, 8),
    time: (document.querySelector('.player-bar .time-row')?.textContent ?? '').replace(/\s+/g, ' ').trim()
  }
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

// 先播两首进队列（模拟真实使用：听了几首，队列里有歌）
const list = rows()
list[0]?.querySelector('.col-actions button[title="播放"]')?.click()
await sleep(9000)
list[1]?.querySelector('.col-actions button[title="播放"]')?.click()
await sleep(9000)

out.切歌前 = snap()

const nextBtn = [...document.querySelectorAll('footer.player-bar button')].find((b) =>
  /下一首/.test(b.getAttribute('title') ?? '')
)
if (!nextBtn) return JSON.stringify({ 错误: '没找到下一首按钮' }, null, 1)

nextBtn.click()
const line = []
for (let i = 0; i < 60; i += 1) {
  await sleep(50)
  const s = snap()
  line.push(`${(i + 1) * 50}:p=${s.p} sx=${s.scale === null ? '-' : Math.round(s.scale * 1000) / 1000}`)
}
out.时间线 = line.join('  ')
out.切歌后 = snap()

// 找出异常项
const bad = []
for (let i = 0; i < line.length; i += 1) {
  const sx = Number(/sx=([\d.]+)/.exec(line[i])?.[1] ?? '0')
  if (sx > 1.05) bad.push({ 毫秒: (i + 1) * 50, 值: line[i] })
}
out.超过100-的采样 = bad.slice(0, 8)
out.结论 = bad.length ? `★ 出现 ${bad.length} 个超过 100% 的采样，最大 ${Math.max(...bad.map((b) => Number(/sx=([\d.]+)/.exec(b.值)[1])))}` : '✓ 全程未超过 100%'

return JSON.stringify(out, null, 1)
