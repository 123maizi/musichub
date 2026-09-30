/**
 * 量播放条里「进度轨道」与「播放键」的实际矩形交叠。
 * 用户反馈「播放键和上方的进度条重合」—— 用数字判定，不靠肉眼。
 */
const rect = (el) => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
}
const overlap = (a, b) => {
  if (!a || !b) return null
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return { 横向交叠: ox, 纵向交叠: oy, 交叠面积: ox * oy }
}

const bar = document.querySelector('footer.player-bar')
const track = document.querySelector('.progress-track')
const fill = document.querySelector('.progress-fill')
const knob = document.querySelector('.progress-knob')

/**
 * 播放键必须在 footer.player-bar 内部找。
 * 踩过两次坑：① 用 /播放|暂停/ 匹配 title 会误命中侧栏「设置 · 播放 · 下载偏好」；
 * ② 用 `footer` 当选择器会命中搜索页的分页行 footer（它也是 37px 高）。
 * 所以这里用精确的根类名 + 作用域内查找。
 */
let play = null
if (bar) {
  const btns = [...bar.querySelectorAll('.buttons .ctrl, .ctrl')]
  play =
    btns.find((b) => /暂停|播放/.test(b.getAttribute('title') ?? '')) ??
    btns[Math.floor(btns.length / 2)] ??
    null
}

const out = {
  载入的入口: [...document.querySelectorAll('script[src]')].map((s) => s.src.split('/').pop()).join(','),
  页面启动时刻: performance.timeOrigin ? new Date(performance.timeOrigin).toLocaleString() : '?',
  播放条: rect(bar),
  进度轨道: rect(track),
  进度填充: rect(fill),
  进度圆点: rect(knob),
  播放键: rect(play),
  轨道与播放键交叠: overlap(rect(track), rect(play)),
  圆点与播放键交叠: overlap(rect(knob), rect(play)),
  轨道命中区高度: track ? getComputedStyle(track).height : null,
  播放键中心点命中元素: null
}

if (play) {
  const r = play.getBoundingClientRect()
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
  out.播放键中心点命中元素 =
    (el?.tagName ?? '?') + (el?.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : '')
  out.播放键中心点是否就是播放键 = el === play || play.contains(el) ? '✓' : '✗ 被别的元素挡住了'
}

return JSON.stringify(out, null, 1)
