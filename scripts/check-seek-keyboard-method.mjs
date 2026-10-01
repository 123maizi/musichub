/**
 * 一次回答两个问题：
 * A. 当前环境可不可信（rAF 帧数 / document.hidden）—— 决定上一组 seek 数字能不能用
 * B. 键盘 5 秒在**真实按键**下成不成立（探针若用 stepUp() 会绕过 keydown 拦截）
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

// A. 环境守卫
out.环境 = { hidden: document.hidden, visibility: document.visibilityState }
out.rAF帧数 = await new Promise((res) => {
  let n = 0
  const t0 = performance.now()
  const tick = () => {
    n += 1
    if (performance.now() - t0 < 600) requestAnimationFrame(tick)
    else res(n)
  }
  requestAnimationFrame(tick)
  setTimeout(() => res(n), 800)
})
out.环境可信 = out.rAF帧数 > 10 && !document.hidden

// B. 找到 seek 输入框
const rail = [...document.querySelectorAll('.rail .nav-item')].find((x) =>
  (x.querySelector('.nav-label')?.textContent ?? '').includes('搜索')
)
rail?.click()
await sleep(1500)
// 播一首，保证有时长
const rows = [...document.querySelectorAll('.results .row')]
if (rows.length) {
  rows[0].querySelector('.col-actions button[title="播放"]')?.click()
  await sleep(4000)
}
location.hash = '#/now-playing'
await sleep(2500)

const el = document.querySelector('input.seek')
out.输入框 = el
  ? { step: el.step, max: el.max, value: el.value, disabled: el.disabled, 可见: el.offsetParent !== null }
  : '没找到 input.seek'

if (el && !el.disabled) {
  el.focus()
  await sleep(300)
  const before = Number(el.value)

  // 方式 1：真实按键（走 keydown，能被拦截）
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
  await sleep(600)
  const afterKey = Number(el.value)

  // 方式 2：stepUp()（绕过 keydown，只受 step 影响）
  const beforeStepUp = Number(el.value)
  el.stepUp()
  await sleep(300)
  const afterStepUp = Number(el.value)

  out.键盘 = {
    起点: before,
    真实按键后: afterKey,
    真实按键步进秒: Number((afterKey - before).toFixed(2)),
    '真实按键=5秒': Math.abs(afterKey - before - 5) < 0.6 ? '✓' : '✗',
    stepUp前: beforeStepUp,
    stepUp后: afterStepUp,
    stepUp步进秒: Number((afterStepUp - beforeStepUp).toFixed(2)),
    说明: '若真实按键=5 而 stepUp≈0.1，说明实现是对的、探针用错了方法'
  }
  out.存储位置 = (() => {
    try {
      return document.querySelector('.time-row')?.innerText ?? null
    } catch {
      return null
    }
  })()
}

location.hash = '#/search'
return JSON.stringify(out, null, 1)
