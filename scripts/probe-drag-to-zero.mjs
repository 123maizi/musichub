/**
 * 专测「把底部进度条拉到最左（0）」——看音频真实位置有没有真的回到 0。
 * 判据用播放条上的时间文本（那是音频元素自己的读数），不是进度条的百分比。
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
const timeText = () =>
  (document.querySelector('.player-bar .time-row')?.textContent ?? '').replace(/\s+/g, ' ').trim()
const audioTime = () => {
  const a = document.querySelector('audio')
  return a ? Math.round(a.currentTime * 10) / 10 : null
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
rows()[0]?.querySelector('.col-actions button[title="播放"]')?.click()
await sleep(14000)

out.拖动前 = { 进度: pct('.progress-fill'), 时间: timeText(), 音频秒: audioTime() }

const input = document.querySelector('.progress-input')
out.输入框 = input
  ? { step: input.step, min: input.min, max: input.max, value: input.value, disabled: input.disabled }
  : '没找到'

if (!input) return JSON.stringify(out, null, 1)

// 模拟拖到最左：直接把 value 设成 min 并派发事件
const fire = (v) => {
  input.value = String(v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

// 先拖到 50% 验证基准可用
fire(Number(input.max) * 0.5)
await sleep(1500)
out.拖到50_后 = { 进度: pct('.progress-fill'), 时间: timeText(), 音频秒: audioTime() }

// 再拖到 0
fire(0)
await sleep(1500)
out.拖到0_后 = { 进度: pct('.progress-fill'), 时间: timeText(), 音频秒: audioTime() }

// 再等 2 秒看音频是不是真的从 0 开始播
await sleep(2000)
out.再等2秒 = { 进度: pct('.progress-fill'), 时间: timeText(), 音频秒: audioTime() }

out.判定 =
  out.拖到0_后.音频秒 !== null && out.拖到0_后.音频秒 < 3
    ? '✓ 音频真的回到 0 了'
    : `★ 音频没回到 0（拖到0后音频秒=${out.拖到0_后.音频秒}，时间显示「${out.拖到0_后.时间}」）`

return JSON.stringify(out, null, 1)
