/** 覆盖层可见性验证（第二步）：派发真实鼠标移动后读伪元素 opacity */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $$ = (s) => [...document.querySelectorAll(s)]
const $ = (s) => document.querySelector(s)
const row = $$('.results .row')[0]
const read = (label) => {
  const before = getComputedStyle(row, '::before')
  const after = getComputedStyle(row, '::after')
  return {
    label,
    beforeOpacity: before.opacity,
    beforeBg: before.backgroundColor,
    afterOpacity: after.opacity,
    afterBg: after.backgroundColor,
    afterBgImage: after.backgroundImage,
    rowBoxShadow: getComputedStyle(row).boxShadow
  }
}
await sleep(120)
return read('已派发真实鼠标移动 ~400ms 后')
