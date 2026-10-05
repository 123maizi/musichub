/**
 * 验证「加载失败自动换源重试」与「不再无限加载」。
 * 手法：临时改写 HTMLMediaElement.play ——
 *   情况 A：前 1 次拒绝（模拟媒体 no supported source），之后正常 → 应当自动换源并最终播起来
 *   情况 B：一直拒绝 → 应当出错误提示且 loading 结束，绝不一直转圈
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const rail = (l) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(l)
  )
const rows = () => [...document.querySelectorAll('.results .row')]
const state = () => {
  const el = document.querySelector('.pb-state')
  if (!el) return null
  const o = {}
  for (const a of el.attributes) o[a.name.replace('data-', '')] = a.value
  return o
}
const loadingDot = () => !!document.querySelector('.loading, .spinner, [class*="loading" i]')

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
const origPlay = HTMLMediaElement.prototype.play

/* ---------- 情况 A：前 1 次 play() 拒绝 ---------- */
let calls = 0
HTMLMediaElement.prototype.play = function (...args) {
  calls += 1
  if (calls === 1) {
    return Promise.reject(new DOMException('simulated no supported source', 'NotSupportedError'))
  }
  return origPlay.apply(this, args)
}

list[0]?.querySelector('.col-actions button[title="播放"]')?.click()
await sleep(3000)
const midA = { play调用次数: calls, 状态: state() }
await sleep(9000)
const endA = { play调用次数: calls, 状态: state() }

out.情况A_前一次失败 = {
  期间play调用次数: calls,
  '3秒时': midA.状态 ? { playing: midA.状态.playing, progress: Number(midA.状态.progress).toFixed(1) } : null,
  '12秒时': endA.状态 ? { playing: endA.状态.playing, progress: Number(endA.状态.progress).toFixed(1), cur: Number(endA.状态.current).toFixed(1) } : null,
  判定: calls >= 2 ? '✓ 触发了自动重试（play 被调用 ' + calls + ' 次）' : '★ 没有重试',
  最终是否播起来: endA.状态 && endA.状态.playing === 'true' && Number(endA.状态.current) > 1 ? '✓ 播起来了' : '★ 没播起来'
}

/* ---------- 情况 B：play() 一直拒绝 ---------- */
HTMLMediaElement.prototype.play = function () {
  return Promise.reject(new DOMException('simulated always fail', 'NotSupportedError'))
}
const t0 = Date.now()
list[1]?.querySelector('.col-actions button[title="播放"]')?.click()
// 判据要盯「最终错误文案」而不是 playing —— playing 在加载初期本来就是 false
let ended = null
for (let i = 0; i < 75; i += 1) {
  await sleep(1000)
  const txt = document.body.innerText
  if (/已试过 \d+ 个音源/.test(txt)) {
    ended = { 用时秒: Math.round((Date.now() - t0) / 1000), 文案: (txt.match(/播放失败：[^\n]*/) ?? [''])[0].slice(0, 60) }
    break
  }
}
out.情况B_一直失败 = {
  是否终止加载: ended ? '✓ 在 ' + ended.用时秒 + ' 秒内结束（没有无限转圈）' : '★ 60 秒仍未结束 —— 还在转圈',
  错误提示: (document.querySelector('.toast, [class*="error" i]')?.textContent ?? '').trim().slice(0, 60) || null,
  最终状态: ended ? { playing: ended.状态.playing } : null
}

HTMLMediaElement.prototype.play = origPlay
return JSON.stringify(out, null, 1)
