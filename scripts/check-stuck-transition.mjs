/** 量那个卡住的 .route-leave-active 元素，找出「离开动画为什么不结束」 */
const out = {}
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
out.reducedMotion = reduce ? '系统开启了减少动效' : '未开启'

const stuck = document.querySelector('.route-leave-active')
if (!stuck) {
  out.结论 = '当前没有卡住的元素'
} else {
  const cs = getComputedStyle(stuck)
  out.卡住的元素 = {
    标签: stuck.tagName,
    类名: stuck.className,
    是否还有enter类: !!document.querySelector('.route-enter-active, .route-enter-from'),
    transitionProperty: cs.transitionProperty,
    transitionDuration: cs.transitionDuration,
    transitionDelay: cs.transitionDelay,
    transitionTimingFunction: cs.transitionTimingFunction,
    opacity: cs.opacity,
    transform: cs.transform,
    display: cs.display,
    子元素数: stuck.querySelectorAll('*').length
  }
  // 把 duration 拆开看最长值 —— Vue 会用最长值做超时兜底
  const durs = cs.transitionDuration.split(',').map((s) => parseFloat(s) * (s.includes('ms') ? 1 : 1000))
  const delays = cs.transitionDelay.split(',').map((s) => parseFloat(s) * (s.includes('ms') ? 1 : 1000))
  out.最长时长ms = Math.max(...durs)
  out.最长延迟ms = Math.max(...delays)
  out.属性个数 = cs.transitionProperty.split(',').length
  out.结论 =
    out.最长时长ms > 60000
      ? '时长异常巨大 —— Vue 的超时兜底要等很久（根因）'
      : out.属性个数 > 2
        ? '属性个数多于 CSS 里声明的 2 个 —— 有别的规则在叠加 transition'
        : '时长与属性都正常，问题可能在 transitionend 不来（Vue 应走超时兜底，需查版本行为）'

  // 看看是不是有别的规则给它加了 transition
  out.叠加来源可疑项 = [...document.styleSheets]
    .flatMap((s) => {
      try {
        return [...s.cssRules]
      } catch {
        return []
      }
    })
    .filter((r) => r.selectorText && /route-leave|no-motion|^\*$/.test(r.selectorText))
    .map((r) => r.selectorText + ' { ' + (r.style.transition || r.style.transitionDuration || '') + ' }')
    .slice(0, 8)
}

return JSON.stringify(out, null, 1)
