/**
 * 验证：自动换源期间**不出现任何红标**。
 * 手法：让第一次 play() 失败、之后正常，全程 30ms 采样错误条的文本。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const rail = (l) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(l)
  )
const rows = () => [...document.querySelectorAll('.results .row')]
const errText = () => {
  const el = document.querySelector('.error-strip')
  return el ? (el.innerText ?? '').replace(/\s+/g, ' ').trim() : ''
}

rail('搜索')?.click()
await sleep(2500)
if (rows().length === 0) {
  const inp = document.querySelector('.search-box input')
  inp.focus()
  inp.value = '周杰伦'
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(250)
  inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    if (rows().length > 0) break
  }
}
const list = rows()
if (list.length < 2) return JSON.stringify({ 错误: '搜索结果不足' }, null, 1)

const origPlay = HTMLMediaElement.prototype.play

/* ---- 场景一：第一次失败、之后成功 → 全程不该有任何红标 ---- */
let calls = 0
HTMLMediaElement.prototype.play = function (...args) {
  calls += 1
  if (calls === 1) {
    return Promise.reject(new DOMException('simulated', 'NotSupportedError'))
  }
  return origPlay.apply(this, args)
}

list[0]?.querySelector('.col-actions button[title="播放"]')?.click()
const seen = []
const t0 = performance.now()
for (let i = 0; i < 150; i += 1) {
  await sleep(30)
  const t = errText()
  if (t) seen.push({ 毫秒: Math.round(performance.now() - t0), 文本: t.slice(0, 60) })
}

const st = document.querySelector('.pb-state')
out.场景一_重试后成功 = {
  期间play调用: calls,
  出现红标的采样数: seen.length,
  红标内容: seen.slice(0, 4),
  最终playing: st ? st.getAttribute('data-playing') : null,
  判定: seen.length === 0 ? '✓ 全程无红标（换源完全静默）' : '★ 仍出现了 ' + seen.length + ' 次红标'
}

/* ---- 场景二：一直失败 → 应当给出一次明确错误 ---- */
HTMLMediaElement.prototype.play = function () {
  return Promise.reject(new DOMException('simulated always', 'NotSupportedError'))
}
list[1]?.querySelector('.col-actions button[title="播放"]')?.click()
let finalErr = ''
for (let i = 0; i < 90; i += 1) {
  await sleep(1000)
  const t = errText()
  if (t && /已试过|全部音源|无法播放/.test(t)) {
    finalErr = t
    break
  }
  if (t) finalErr = t
}
out.场景二_彻底失败 = {
  最终红标: finalErr.slice(0, 70) || '（没有红标 —— 这可能不对）',
  判定: finalErr ? '✓ 彻底失败时有明确提示' : '★ 彻底失败却没有任何提示'
}

HTMLMediaElement.prototype.play = origPlay
return JSON.stringify(out, null, 1)
