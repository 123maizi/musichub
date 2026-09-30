/** 决定性测试：rAF 是否在跑？.route-leave-to 有没有样式？ */
const out = {}

// 1. rAF 是否在跑
let frames = 0
const t0 = performance.now()
const tick = () => {
  frames += 1
  if (performance.now() - t0 < 600) requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
await new Promise((r) => setTimeout(r, 800))
out.rAF = { '600ms内帧数': frames, 判定: frames > 10 ? '✔ 正常（不是节流问题）' : '✘ 被节流' }
out.documentHidden = document.hidden
out.visibilityState = document.visibilityState

// 2. route-* 四条规则的真实声明
const rules = {}
for (const sheet of document.styleSheets) {
  let list
  try {
    list = [...sheet.cssRules]
  } catch {
    continue
  }
  for (const r of list) {
    if (r.selectorText && /^\.route-(enter|leave)/.test(r.selectorText)) {
      rules[r.selectorText] = r.style.cssText || '(空 —— 没有任何声明)'
    }
  }
}
out.route规则 = rules

// 3. 卡住元素的实际状态
const stuck = document.querySelector('.route-leave-active')
out.卡住元素 = stuck
  ? {
      类名: stuck.className,
      opacity: getComputedStyle(stuck).opacity,
      transform: getComputedStyle(stuck).transform,
      停留时长说明: '若 leave-from 一直在，说明 Vue 的 nextFrame 回调没跑'
    }
  : '无'

// 4. 手动模拟：如果加上 leave-to 的样式，会不会动？
out.结论提示 =
  !rules['.route-leave-to'] || rules['.route-leave-to'].includes('空')
    ? '★ .route-leave-to 没有任何声明 —— 即使 Vue 正常走到那一步，属性值也不会变化，过渡永远不会开始、transitionend 永不到来，mode="out-in" 于是永久卡死'
    : '.route-leave-to 有声明，问题在 Vue 的 nextFrame 没执行'

return JSON.stringify(out, null, 1)
