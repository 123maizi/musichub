/**
 * 复选框命中区验证探针（task-8 · WCAG 2.5.8）
 *
 * 为什么单写一个：design-audit 只会告诉我们「<24px 的可点元素还有几个」，
 * 不会告诉我们**伪元素到底画没画出来** —— 而 `appearance:none` 之后，
 * 视觉方块与对勾全靠 `::before` / `::after`。万一浏览器不给 input 渲染伪元素，
 * 命中区是达标了，但复选框会变成一片空白（比不达标更糟）。
 * 所以这里用 getComputedStyle(el, '::before') 直接读伪元素的真实计算值。
 *
 * 同时验证功能没坏：真实点击切换一个开关，配置必须跟着变，然后再切回来。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { steps: {} }

// 导航走导航柱：location.hash 在这个外壳里 hash 变了视图常常不换
{
  const b = [...document.querySelectorAll('.nav-item')].find(
    (x) => (x.getAttribute('aria-label') || '') === '设置'
  )
  if (b) b.click()
  else location.hash = '#/settings'
}
await sleep(2000)

const boxes = [...document.querySelectorAll('.check input[type="checkbox"]')]
out.steps.count = boxes.length
if (boxes.length === 0) throw new Error('设置页找不到复选框')

out.steps.geometry = boxes.map((el, i) => {
  const r = el.getBoundingClientRect()
  const before = getComputedStyle(el, '::before')
  const after = getComputedStyle(el, '::after')
  return {
    i,
    hit: Math.round(r.width) + 'x' + Math.round(r.height),
    hitOk: r.width >= 24 && r.height >= 24,
    visualBox: before.width + ' x ' + before.height,
    visualRadius: before.borderTopLeftRadius,
    boxBg: before.backgroundColor,
    checkOpacity: after.opacity,
    checkTransform: after.transform,
    disabled: el.disabled
  }
})

out.steps.allHitOk = out.steps.geometry.every((g) => g.hitOk)
out.steps.allVisualBoxDrawn = out.steps.geometry.every(
  (g) => parseFloat(g.visualBox) > 0 && g.boxBg !== 'rgba(0, 0, 0, 0)'
)
out.steps.checkedCount = boxes.filter((b) => b.checked).length

/* ---------- 真实点击切换 + 还原，确认功能没被 CSS 改坏 ---------- */
const pick = (c) => ({
  enabled: c.enabled,
  fallback: c.fallbackToPublic,
  deep: c.deepThinking,
  disableThinking: c.disableThinking
})
const idx = boxes.findIndex((b) => !b.disabled)
if (idx >= 0) {
  const el = boxes[idx]
  const rect = el.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2

  const before = await window.api.ai.getConfig()
  const fire = (type) => {
    el.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: cx,
        clientY: cy,
        button: 0
      })
    )
  }
  // label 包着 input：点 label 也会切换，这里直接点 input 本体
  fire('mousedown')
  fire('mouseup')
  fire('click')
  await sleep(500)
  const mid = await window.api.ai.getConfig()
  const afterStyle = getComputedStyle(el, '::after')

  // 还原：再点一次即可（点击本身会翻转 checked，不要手工改 .checked 再点，
  // 那样等于翻转两次，Vue 读到的值与预期相反 —— 上一轮「已还原: false」就是这么来的）
  fire('mousedown')
  fire('mouseup')
  fire('click')
  await sleep(500)
  const restored = await window.api.ai.getConfig()

  out.steps.toggle = {
    index: idx,
    before: { enabled: before.enabled, fallback: before.fallbackToPublic, deep: before.deepThinking, disableThinking: before.disableThinking },
    after: { enabled: mid.enabled, fallback: mid.fallbackToPublic, deep: mid.deepThinking, disableThinking: mid.disableThinking },
    restored: { enabled: restored.enabled, fallback: restored.fallbackToPublic, deep: restored.deepThinking, disableThinking: restored.disableThinking },
    // 只比「被这个开关影响的字段」。比整份 config 会带上 updatedAt 时间戳，
    // 那个必然不同，会把「已还原」判成 false —— 上一轮就是这么误报的。
    changed: JSON.stringify(pick(before)) !== JSON.stringify(pick(mid)),
    restoredBack: JSON.stringify(pick(before)) === JSON.stringify(pick(restored)),
    checkedNow: el.checked,
    checkOpacityNow: afterStyle.opacity,
    checkTransformNow: afterStyle.transform
  }
}

return out
