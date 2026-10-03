/**
 * 换歌后的完整时间线（50ms 采样 4 秒）
 * 目的：任何残留值 / 倒放动画 / 中间帧都逃不掉。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

const rail = [...document.querySelectorAll('.rail .nav-item')].find((x) =>
  (x.querySelector('.nav-label')?.textContent ?? '').includes('搜索')
)
rail?.click()
await sleep(2200)

const rows = () => [...document.querySelectorAll('.results .row')]
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

const fill = () => document.querySelector('.progress-fill')
const pct = () => {
  const el = fill()
  if (!el) return null
  const t = getComputedStyle(el).transform
  const m = /matrix\(([-\d.]+)/.exec(t)
  return m ? Math.round(Number(m[1]) * 1000) / 10 : null
}
const title = () => (document.querySelector('.player-bar .now-title')?.textContent ?? '').trim().slice(0, 12)
const timeText = () => (document.querySelector('.player-bar .time-row')?.textContent ?? '').replace(/\s+/g, ' ').trim()
const thumbStyle = () => {
  const k = document.querySelector('.progress-knob')
  return k ? getComputedStyle(k).transform.match(/matrix\(([-\d.]+)/)?.[1] ?? null : null
}

// 播第一首，等进度涨到可观
rows()[0]?.querySelector('.col-actions button[title="播放"]')?.click()
await sleep(14000)
out.换歌前 = { 曲目: title(), 进度: pct(), 时间: timeText(), 滑块: thumbStyle() }

// 切第二首，50ms 高频采样 4 秒
const t0 = performance.now()
rows()[1]?.querySelector('.col-actions button[title="播放"]')?.click()
const line = []
for (let i = 0; i < 80; i += 1) {
  await sleep(50)
  line.push({ ms: Math.round(performance.now() - t0), p: pct(), t: thumbStyle() })
}
out.换歌后时间线 = line.map((s) => `${s.ms}:${s.p}`).join(' ')
out.换歌后 = { 曲目: title(), 进度: pct(), 时间: timeText(), 滑块: thumbStyle() }

// 判定
const after = line.filter((s) => s.ms <= 1500)
const maxAfter = Math.max(...after.map((s) => s.p ?? 0))
const firstNonZero = line.find((s) => (s.p ?? 0) > 0)
out.判定 = {
  换歌前进度: out.换歌前.进度,
  '前1_5秒最大进度': maxAfter,
  首次非零出现在: firstNonZero ? firstNonZero.ms + 'ms (值 ' + firstNonZero.p + ')' : '4 秒内一直为 0',
  结论:
    maxAfter <= Math.max(1, (out.换歌前.进度 ?? 0) * 0.3)
      ? '✓ 无残留'
      : '★ 有残留：换歌后 1.5 秒内最大值 ' + maxAfter + '%'
}

return JSON.stringify(out, null, 1)
