/** 验证：换歌后进度条是否归零（不残留上一首的进度） */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { 采样: [] }

const rail = [...document.querySelectorAll('.rail .nav-item')].find((x) =>
  (x.querySelector('.nav-label')?.textContent ?? '').includes('搜索')
)
rail?.click()
await sleep(2000)

const rows = () => [...document.querySelectorAll('.results .row')]
if (rows().length === 0) {
  const input = document.querySelector('.search-box input')
  input.focus()
  input.value = '周杰伦'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(300)
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    if (rows().length > 0) break
  }
}

const fillPct = () => {
  const el = document.querySelector('.progress-fill')
  if (!el) return null
  const t = getComputedStyle(el).transform
  const m = /matrix\(([-\d.]+)/.exec(t)
  return m ? Math.round(Number(m[1]) * 1000) / 10 : null
}
const nowTitle = () =>
  (document.querySelector('.player-bar .now-title')?.textContent ?? '').trim().slice(0, 16)

// 播第一首，等进度涨上去
const list = rows()
list[0]?.querySelector('.col-actions button[title="播放"]')?.click()
await sleep(10000)
const firstTitle = nowTitle()
const firstPct = fillPct()
out.第一首 = { 曲目: firstTitle, 进度百分比: firstPct }

// 切第二首
list[1]?.querySelector('.col-actions button[title="播放"]')?.click()
// 立刻密集采样：换歌瞬间进度应该是 0，而不是上一首的百分比
for (let i = 0; i < 14; i += 1) {
  await sleep(250)
  out.采样.push({ 毫秒后: (i + 1) * 250, 曲目: nowTitle(), 进度: fillPct() })
}
out.第二首 = { 曲目: nowTitle(), 进度百分比: fillPct() }

const maxRightAfter = Math.max(...out.采样.slice(0, 6).map((s) => s.进度 ?? 0))
out.判定 =
  maxRightAfter <= Math.max(3, (firstPct ?? 0) * 0.2)
    ? `✓ 换歌后进度已归零（换歌瞬间最大 ${maxRightAfter}% ，上一首是 ${firstPct}%）`
    : `★ 复现：换歌后仍残留进度（换歌瞬间最大 ${maxRightAfter}%，上一首 ${firstPct}%）`

return JSON.stringify(out, null, 1)
