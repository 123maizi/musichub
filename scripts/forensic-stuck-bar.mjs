/**
 * 现场取证：进度条划不动的那一刻，各组件的真实状态。
 * ⚠️ 只读，不做任何操作（不点击、不重启）。
 */
const out = {}
const attr = (el) => {
  if (!el) return null
  const o = {}
  for (const a of el.attributes) o[a.name] = a.value
  return o
}

out.路由 = location.hash
out.窗口 = { hidden: document.hidden, visibility: document.visibilityState }

/* 1. 组件内部状态（.pb-state 出口） */
out.组件状态 = attr(document.querySelector('.pb-state'))

/* 2. 底部播放条的进度 input */
const inp = document.querySelector('.progress-input')
if (inp) {
  const r = inp.getBoundingClientRect()
  const cs = getComputedStyle(inp)
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  out.底部input = {
    min: inp.min,
    max: inp.max,
    step: inp.step,
    value: inp.value,
    valueAsNumber: inp.valueAsNumber,
    disabled: inp.disabled,
    尺寸: Math.round(r.width) + 'x' + Math.round(r.height),
    位置: `left=${Math.round(r.left)} top=${Math.round(r.top)}`,
    pointerEvents: cs.pointerEvents,
    visibility: cs.visibility,
    opacity: cs.opacity,
    display: cs.display,
    zIndex: cs.zIndex,
    中心命中: hit ? hit.tagName + '.' + (typeof hit.className === 'string' ? hit.className : '') : 'null',
    命中是不是它自己: hit === inp ? '✓' : '✗ 被别的元素盖住',
    外层pointerEvents: inp.parentElement ? getComputedStyle(inp.parentElement).pointerEvents : null,
    外层类名: inp.parentElement ? inp.parentElement.className : null
  }
} else {
  out.底部input = '没找到 .progress-input'
}

/* 3. 详细页的 seek input（对照组：它正常） */
const seek = document.querySelector('input.seek')
out.详细页input = seek
  ? { min: seek.min, max: seek.max, step: seek.step, value: seek.value, disabled: seek.disabled }
  : '当前不在详细页／没挂载'

/* 4. 可见填充 */
const railEl = document.querySelector('.progress-rail')
const fill = document.querySelector('.progress-fill')
const m = fill ? /matrix\(([-\d.]+)/.exec(getComputedStyle(fill).transform) : null
out.填充 = {
  '--p': railEl ? getComputedStyle(railEl).getPropertyValue('--p').trim() : null,
  scaleX: m ? Number(m[1]) : null,
  时间文本: (document.querySelector('.player-bar .time-row')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
  曲目: (document.querySelector('.player-bar .now-title')?.textContent ?? '').trim()
}

/* 5. 是否卡在拖动中：看有没有全局的 pointerup 丢失迹象 */
out.其他 = {
  正在播放页是否挂载: !!document.querySelector('.seek-fill'),
  页面上的toast: (document.querySelector('.toast')?.textContent ?? '').trim().slice(0, 60) || null,
  错误文本: (document.body.innerText.match(/播放失败[^。\n]*/) ?? [''])[0].slice(0, 60)
}

return JSON.stringify(out, null, 1)
