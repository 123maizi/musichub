/**
 * 设计审计（design audit）—— 在**真实渲染结果**上量，而不是靠感觉说好看。
 *
 * ── 附：定位「每帧多花 N 毫秒」的消融法（ablation）─────────────────
 * 这套方法用来回答「到底是哪个 CSS 属性在拖帧」，比盯着代码猜快得多：
 *   1. 先用本脚本量出基线（布局属性动画数、LayoutCount、帧间隔、元素数）。
 *   2. 一次只改**一个**属性（例如给容器加 `isolation: isolate`、
 *      把 `will-change` 去掉、把某个 `z-index`/`filter`/`backdrop-filter` 拿掉），
 *      重建 + 重启实例，再量同一组指标。一次只动一个变量，否则无法归因。
 *   3. 用 CDP `Performance.getMetrics` 看 LayoutCount / RecalcStyleCount /
 *      LayoutDuration 的差值 —— 帧间隔在快机器上会被 vsync 抹平，
 *      但「一次操作换来多少次样式重算 + 布局」骗不了人（见本脚本第 8 节）。
 *   4. 找到可疑属性后用 `document.getAnimations()` + `PerformanceObserver('longtask')`
 *      确认它确实在每帧产生工作，而不是恰好同帧的噪声。
 * 实例：团队用这个方法抓到 `.row { z-index }` 让每帧多 1.4ms（大量层叠上下文
 * 迫使合成器反复分组），改成在表格容器上 `isolation: isolate` 建立单一层叠根后消失。
 * 记录结论时请一并写下「改前/改后的指标数字」，否则下次没人能复现判断。
 *
 * 为什么要有它：skill 里 design-system 的核心主张是「先定约束，再写组件，
 * 最后用测量验收」。人眼会说「差不多挺好看」，但量不出来：
 *  · 到底出现了多少种字号（约束说 4-6 种）
 *  · 有多少正文没达 WCAG AA 对比度
 *  · 有多少 padding/margin 不在 4px 网格上
 *  · 调色板漂移了多少种颜色、几个圆角、几层阴影
 *  · 有多少可点区域小于 24px（WCAG 2.5.8）
 *  · 动效出现了多少种时长/easing，有没有 prefers-reduced-motion 兜底
 *  · 切路由时到底有没有过渡（直接看有没有正在跑的 animation）
 *
 * 用法：
 *   node scripts/design-audit.mjs <cdp端口>            完整审计 + 路由动效探测
 *   node scripts/design-audit.mjs <cdp端口> --json     只输出原始 JSON
 *   node scripts/design-audit.mjs <cdp端口> --no-route 跳过路由动效探测（不切页面）
 *   node scripts/design-audit.mjs <cdp端口> --at=#/downloads  先切到指定路由再采样
 *
 * 改这个文件时注意：AUDIT_SRC 是一个**模板字符串**，里面的注释与代码都不能出现
 * 反引号（会把模板截断成语法错误）。改完跑 `node scripts/lint-audit-template.mjs` 自查。
 */
const PORT = Number(process.argv[2] || 9223)
const AS_JSON = process.argv.includes('--json')
const SKIP_ROUTE = process.argv.includes('--no-route')
/** --at=#/downloads 先切到指定路由再采样（每个视图的样式漂移不一样，要分开量） */
const AT = (process.argv.find((a) => a.startsWith('--at=')) || '').slice(5)

/* ------------------------------ CDP 连接 ------------------------------ */

async function pickPage() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const list = await res.json()
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('找不到渲染进程 target')
  return page
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let id = 0
    const pending = new Map()
    ws.addEventListener('open', () =>
      resolve({
        send(method, params) {
          return new Promise((res, rej) => {
            const mid = ++id
            pending.set(mid, { res, rej })
            ws.send(JSON.stringify({ id: mid, method, params }))
          })
        },
        close: () => ws.close()
      })
    )
    ws.addEventListener('error', () => reject(new Error('WS 连接失败')))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) rej(new Error(JSON.stringify(msg.error)))
        else res(msg.result)
      }
    })
  })
}

async function evaluate(cdp, expression) {
  const out = await cdp.send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  })
  if (out.exceptionDetails) {
    const d = out.exceptionDetails
    throw new Error(d.exception?.description ?? d.text ?? '页面内执行异常')
  }
  return out.result?.value
}

/* ------------------------------ 页面内审计 ------------------------------ */

const AUDIT_SRC = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---- 颜色工具 ---- */
function parseColor(text) {
  const m = /^rgba?\\(([^)]+)\\)$/.exec(String(text || '').trim())
  if (!m) return null
  const parts = m[1].split(',').map((s) => parseFloat(s))
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
}
function lum(c) {
  const f = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}
function contrast(a, b) {
  const l1 = lum(a)
  const l2 = lum(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}
function blend(fg, bg) {
  const a = fg.a
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }
}
function effectiveBg(el) {
  let node = el
  let acc = null
  while (node && node.nodeType === 1) {
    const c = parseColor(getComputedStyle(node).backgroundColor)
    if (c && c.a > 0) {
      acc = acc ? blend(acc, c) : c
      if (acc.a >= 0.999) return acc
    }
    node = node.parentElement
  }
  const body = parseColor(getComputedStyle(document.body).backgroundColor) || { r: 11, g: 11, b: 15, a: 1 }
  return acc ? blend(acc, body) : body
}

/* ---- 遍历可见元素 ---- */
const all = [...document.querySelectorAll('*')]
const visible = []
for (const el of all) {
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) continue
  const cs = getComputedStyle(el)
  if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
  visible.push({ el, cs, rect: r })
}

function bump(map, key, sample) {
  if (!key) return
  const e = map.get(key) || { count: 0, samples: [] }
  e.count += 1
  if (sample && e.samples.length < 3 && !e.samples.includes(sample)) e.samples.push(sample)
  map.set(key, e)
}
const asList = (map, sortBy) =>
  [...map.entries()]
    .map(([value, e]) => ({ value, count: e.count, samples: e.samples }))
    .sort((a, b) => (sortBy === 'count' ? b.count - a.count : String(a.value).localeCompare(String(b.value))))

/* ---- 1. 字号刻度 ---- */
const fontSizes = new Map()
for (const { cs } of visible) bump(fontSizes, cs.fontSize)

/* ---- 2. 字体族 ---- */
const families = new Map()
for (const { cs } of visible) bump(families, cs.fontFamily.split(',')[0].replace(/["']/g, '').trim())

/* ---- 3. 文字颜色 / 背景色 ---- */
const textColors = new Map()
const bgColors = new Map()
for (const { cs } of visible) {
  bump(textColors, cs.color)
  if (parseColor(cs.backgroundColor)?.a > 0) bump(bgColors, cs.backgroundColor)
}

/* ---- 4. 对比度（只算真的有文字的元素） ---- */
function hasOwnText(el) {
  for (const n of el.childNodes) {
    if (n.nodeType === 3 && n.textContent.trim().length > 0) return true
  }
  return false
}
const contrastFails = []
let contrastChecked = 0
for (const { el, cs, rect } of visible) {
  if (!hasOwnText(el)) continue
  const fg = parseColor(cs.color)
  if (!fg || fg.a === 0) continue
  const bg = effectiveBg(el)
  const ratio = contrast(fg.a < 1 ? blend(fg, bg) : fg, bg)
  const px = parseFloat(cs.fontSize)
  const weight = Number(cs.fontWeight) || 400
  const large = px >= 24 || (px >= 18.66 && weight >= 700)
  const need = large ? 3 : 4.5
  contrastChecked += 1
  if (ratio + 0.01 < need) {
    contrastFails.push({
      selector: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''),
      text: (el.textContent || '').trim().slice(0, 24),
      fontSize: cs.fontSize,
      ratio: Number(ratio.toFixed(2)),
      need,
      color: cs.color
    })
  }
}

/* ---- 5. 间距网格（4px） ---- */
const offGrid = new Map()
let spacingChecked = 0
let autoMarginsSkipped = 0
const SPACING_PROPS = ['paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft','rowGap','columnGap']
for (const { el, cs } of visible) {
  for (const prop of SPACING_PROPS) {
    const raw = cs[prop]
    const v = parseFloat(raw)
    if (!raw || Number.isNaN(v) || v === 0) continue
    /**
     * auto 外边距在 getComputedStyle 里会被解析成「用后的具体像素」
     * （例如 margin-left: auto 报 672.391px）—— 那不是作者写的值，
     * 报成「离网间距」就是纯误报（团队因此查了半天 page-actions）。
     * 手写的间距值不会是小数，所以非整数一律跳过。
     * 注意：本段在模板字符串里，注释中不能出现反引号（会截断模板）。
     */
    if (Math.abs(v - Math.round(v)) > 0.01) {
      autoMarginsSkipped += 1
      continue
    }
    spacingChecked += 1
    if (Math.abs(v % 4) > 0.01) {
      const key = raw + ' (' + prop + ')'
      const e = offGrid.get(key) || { count: 0, samples: [] }
      e.count += 1
      if (e.samples.length < 3) {
        const sig = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : '')
        if (!e.samples.includes(sig)) e.samples.push(sig)
      }
      offGrid.set(key, e)
    }
  }
}

/* ---- 6. 圆角 / 阴影 ----
   阴影只统计「高度感」的那种；0 0 0 Npx 是焦点环（可访问性要求），不算装饰阴影。
   圆角分四桶：契约刻度（--r-ctl/--r-card）、媒体例外（--r-media，用户明确要求）、
   圆形（pill/50%）、以及**真漂移**（只有这一桶计入失败）。
   桶的判定值直接从页面上读 token，所以改 token 会被自动跟着改，不用改审计。 */
const rootStyle = getComputedStyle(document.documentElement)
const tokenOf = (name, fallback) => (rootStyle.getPropertyValue(name) || '').trim() || fallback
const R_CTL = tokenOf('--r-ctl', '2px')
const R_CARD = tokenOf('--r-card', '0px')
const R_MEDIA = tokenOf('--r-media', '6px')
const radiusContract = new Map()
const radiusMedia = new Map()
const radiusRound = new Map()
const radiusDrift = new Map()
const shadows = new Map()
const ringShadows = []
for (const { cs } of visible) {
  const raw = cs.borderTopLeftRadius
  const r = parseFloat(raw)
  if (r > 0) {
    if (r >= 999 || raw.includes('%')) bump(radiusRound, r >= 999 ? 'pill(999px)' : 'circle(50%)')
    else if (raw === R_MEDIA) bump(radiusMedia, raw)
    else if (raw === R_CTL || raw === R_CARD) bump(radiusContract, raw)
    else bump(radiusDrift, raw)
  }
  const shadow = cs.boxShadow
  if (shadow && shadow !== 'none') {
    if (/^(rgba?\([^)]*\)\s*)?0(px)?\s+0(px)?\s+0(px)?\s+\d/.test(shadow) || /inset/.test(shadow)) {
      ringShadows.push(shadow)
    } else {
      bump(shadows, shadow)
    }
  }
}

/* ---- 7. 命中区 < 24px ---- */
const smallTargets = []
for (const { el, rect } of visible) {
  const tag = el.tagName.toLowerCase()
  const clickable = tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button' || tag === 'select' || (tag === 'input' && ['checkbox','radio','button'].includes(el.type))
  if (!clickable) continue
  if (rect.width < 24 || rect.height < 24) {
    smallTargets.push({
      tag: tag + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : ''),
      size: Math.round(rect.width) + 'x' + Math.round(rect.height),
      title: (el.getAttribute('title') || el.textContent || '').trim().slice(0, 18)
    })
  }
}

/* ---- 8. 动效清单 ----
   口径（重要）：transition-duration 是**逗号列表**（例如 transition: a .24s, b .36s），
   老口径直接把整串当 key，于是 "0.24s, 0.24s, 0.24s" 和 "0.24s" 会被算成两种取值，
   种类数虚高（团队据此查了半天「第 4 种时长在哪」）。
   现在一律**拆成单值去重计数**，并记录它出现在哪个元素上 —— 这样报出来的每一档
   都能定位到人。easing / 属性同理。 */
const durations = new Map()
const easings = new Map()
const motionProps = new Map()
let motionElements = 0
let animationElements = 0

const selectorOf = (el) => {
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/)[0] : ''
  return el.tagName.toLowerCase() + (cls ? '.' + cls : '')
}
/** 只按**顶层**逗号切分：cubic-bezier(0.16, 1, 0.3, 1) 括号里的逗号不是分隔符。
    不做这一步的话，一条 easing 会被切成 "cubic-bezier(0.16" / "1" / "0.3" / "1)" 四段，
    种类数凭空多 3 个 —— 实测踩过。 */
const splitTop = (value) => {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of String(value || '')) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}
/** 把逗号列表拆成单值去重计数（同一元素上的重复值只计一次） */
const bumpList = (map, list, sample) => {
  const seen = new Set()
  for (const part of splitTop(list)) {
    const v = part.trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    if (/^0s$/.test(v)) continue
    bump(map, v, sample)
  }
}

/* 布局属性动画：动 width/height/top/left/margin/padding 会触发布局，掉帧重灾区。
   已评估的例外（团队裁决过、代码里写明理由的）单独列，不算违规。 */
const LAYOUT_PROPS = /(^|[\s,])(width|height|top|right|bottom|left|margin|padding|inset|font-size|line-height|border-width|flex-basis|gap)([\s,]|$)/i
const EXCEPTION_SELECTORS = ['.progress-rail', '.seek-rail']
const layoutAnimated = []
const exceptionAnimated = []

for (const { el, cs, rect } of visible) {
  const dur = cs.transitionDuration
  const prop = cs.transitionProperty
  const hasTransition = prop && prop !== 'none' && dur && !/^0s(, 0s)*$/.test(dur)
  const hasAnimation = cs.animationName && cs.animationName !== 'none'
  const sample = selectorOf(el)
  if (hasTransition) {
    motionElements += 1
    bumpList(durations, dur, sample)
    bumpList(easings, cs.transitionTimingFunction, sample)
    bumpList(motionProps, prop, sample)
  }
  if (hasAnimation) {
    animationElements += 1
    bumpList(durations, cs.animationDuration, sample)
    bumpList(easings, cs.animationTimingFunction, sample)
  }

  const cls = typeof el.className === 'string' ? el.className : ''
  const isException = EXCEPTION_SELECTORS.some((s) => cls.includes(s.slice(1)))
  const animatedProps = hasTransition ? prop.split(',').map((s) => s.trim()) : []
  const offending = animatedProps.filter((p) => p !== 'none' && p !== 'all' && LAYOUT_PROPS.test(p))
  if (offending.length > 0 || (hasAnimation && LAYOUT_PROPS.test(cs.animationName))) {
    const entry = {
      selector: el.tagName.toLowerCase() + (cls ? '.' + cls.trim().split(/\\s+/)[0] : ''),
      props: offending.join(','),
      duration: dur,
      size: Math.round(rect.width) + 'x' + Math.round(rect.height)
    }
    if (isException) exceptionAnimated.push(entry)
    else layoutAnimated.push(entry)
  }
}

/* ---- 9. 样式表层面：keyframes 数量 / reduced-motion 覆盖 ---- */
let keyframesRules = 0
let reducedMotionRules = 0
let sheetReadable = 0
let sheetBlocked = 0
for (const sheet of document.styleSheets) {
  let rules = null
  try { rules = sheet.cssRules } catch (e) { sheetBlocked += 1; continue }
  if (!rules) continue
  sheetReadable += 1
  const walk = (list) => {
    for (const r of list) {
      if (r.type === 7) keyframesRules += 1
      if (r.type === 4) {
        if (String(r.conditionText || '').includes('prefers-reduced-motion')) reducedMotionRules += 1
        if (r.cssRules) walk(r.cssRules)
      } else if (r.cssRules) {
        walk(r.cssRules)
      }
    }
  }
  walk(rules)
}

/* ---- 10. emoji 当图标用 ---- */
const emojiRe = /[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{FE0F}]/u
const emojiHits = []
for (const { el } of visible) {
  const tag = el.tagName.toLowerCase()
  if (!['button','a','span','div','label','h1','h2','h3'].includes(tag)) continue
  if (!hasOwnText(el)) continue
  const t = (el.textContent || '').trim()
  if (t.length <= 3 && emojiRe.test(t)) emojiHits.push(tag + ' ' + t)
}

/* ---- 11. 进度条更新成本：width 驱动（布局）vs transform 驱动（合成） ----
   两组用同一套骨架同步对比，所以结果与当前 CSS 是谁无关，纯粹量两种做法的成本差。
   测两件事：
     · 一次「改值 + 强制同步布局」要花多少微秒（真实布局代价）
     · 连续 20 次更新时的平均帧间隔（用户实际感受到的流畅度） */
async function benchProgressDrivers() {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:200px;height:3px;overflow:hidden'
  host.innerHTML = '<i style="display:block;height:100%;width:100%;background:#f0c479"></i>'
  document.body.appendChild(host)
  const fill = host.querySelector('i')

  const useWidth = (v) => {
    fill.style.transform = 'none'
    fill.style.width = v + '%'
  }
  const useScale = (v) => {
    fill.style.width = '100%'
    fill.style.transformOrigin = 'left center'
    fill.style.transform = 'scaleX(' + v / 100 + ')'
  }

  const layoutCost = (setter) => {
    const t0 = performance.now()
    for (let i = 0; i < 60; i += 1) {
      setter(i * 1.6)
      void fill.offsetWidth
    }
    return ((performance.now() - t0) / 60) * 1000
  }
  const frameCost = async (setter) => {
    const gaps = []
    let last = performance.now()
    for (let i = 0; i < 20; i += 1) {
      setter(i * 5)
      await new Promise((r) => requestAnimationFrame(r))
      const now = performance.now()
      gaps.push(now - last)
      last = now
    }
    gaps.sort((a, b) => a - b)
    return gaps[Math.floor(gaps.length / 2)]
  }

  layoutCost(useWidth); layoutCost(useScale)
  const widthLayoutUs = layoutCost(useWidth)
  const scaleLayoutUs = layoutCost(useScale)
  const widthFrameMs = await frameCost(useWidth)
  const scaleFrameMs = await frameCost(useScale)
  host.remove()
  return {
    宽度驱动_单次布局微秒: Number(widthLayoutUs.toFixed(1)),
    变换驱动_单次布局微秒: Number(scaleLayoutUs.toFixed(1)),
    宽度驱动_中位帧间隔ms: Number(widthFrameMs.toFixed(2)),
    变换驱动_中位帧间隔ms: Number(scaleFrameMs.toFixed(2))
  }
}

/* 线上真实的进度条填充用的是哪种驱动 */
const liveBars = []
for (const el of document.querySelectorAll('.bar > i, .progress-fill, .seek-fill, .progress-knob, .seek-knob')) {
  const cs = getComputedStyle(el)
  const inline = el.style.cssText || ''
  liveBars.push({
    selector: el.className || el.tagName.toLowerCase(),
    内联样式: inline.slice(0, 46) || '(无)',
    过渡属性: cs.transitionProperty,
    用变换驱动: cs.transform !== 'none' && /matrix|scale/.test(cs.transform)
  })
}

/* ---- 汇总 ---- */
const report = {
  采样元素数: visible.length,
  字号: { 种类: fontSizes.size, 明细: asList(fontSizes, 'count') },
  字体族: { 种类: families.size, 明细: asList(families, 'count') },
  文字色: { 种类: textColors.size, 明细: asList(textColors, 'count').slice(0, 12) },
  背景色: { 种类: bgColors.size, 明细: asList(bgColors, 'count').slice(0, 12) },
  对比度: { 检查数: contrastChecked, 不达标数: contrastFails.length, 不达标样例: contrastFails.slice(0, 12) },
  间距: {
    检查数: spacingChecked,
    离网种类: offGrid.size,
    离网总数: [...offGrid.values()].reduce((a, b) => a + b.count, 0),
    跳过的auto值: autoMarginsSkipped,
    明细: [...offGrid.entries()].map(([value, e]) => ({ value, count: e.count, samples: e.samples })).sort((a, b) => b.count - a.count).slice(0, 12)
  },
  圆角: {
    契约刻度: asList(radiusContract, 'count'),
    媒体例外: asList(radiusMedia, 'count'),
    圆形: asList(radiusRound, 'count'),
    漂移: asList(radiusDrift, 'count'),
    刻度值: { ctl: R_CTL, card: R_CARD, media: R_MEDIA }
  },
  阴影: { 种类: shadows.size, 明细: asList(shadows, 'count').slice(0, 8) },
  命中区: { 小于24px数量: smallTargets.length, 样例: smallTargets.slice(0, 12) },
  动效: {
    有过渡的元素数: motionElements,
    有动画的元素数: animationElements,
    时长种类: durations.size,
    时长明细: asList(durations, 'count'),
    easing种类: easings.size,
    easing明细: asList(easings, 'count'),
    属性明细: asList(motionProps, 'count').slice(0, 8),
    keyframes规则数: keyframesRules,
    reducedMotion规则数: reducedMotionRules,
    可读样式表: sheetReadable,
    跨域被挡样式表: sheetBlocked,
    布局属性动画数: layoutAnimated.length,
    布局属性动画样例: layoutAnimated.slice(0, 10),
    已评估例外: exceptionAnimated.slice(0, 10)
  },
  进度条驱动: { 线上填充: liveBars, 微基准: await benchProgressDrivers() },
  emoji当图标: { 数量: emojiHits.length, 样例: emojiHits.slice(0, 8) }
}

/* ---- 11. 路由动效探测：切路由时视图根元素到底有没有在动 ----
   只看「页面全局有没有动画」会误判（别处的 hover/微交互也算），
   所以这里盯的是新视图根元素自己的 opacity / transform / 运行中动画数。 */
if (!window.__auditSkipRoute) {
  const routes = ['#/library', '#/downloads', '#/sources', '#/settings', '#/search']
  const routeProbe = []
  for (const r of routes) {
    if (location.hash === r) continue
    location.hash = r
    await sleep(16)
    const root = document.querySelector('main > *')
    const cs = root ? getComputedStyle(root) : null
    const early = {
      opacity: cs ? Number(cs.opacity) : null,
      transform: cs ? cs.transform : null,
      运行中动画: root && root.getAnimations ? root.getAnimations().length : 0
    }
    await sleep(90)
    const root2 = document.querySelector('main > *')
    const cs2 = root2 ? getComputedStyle(root2) : null
    const late = { opacity: cs2 ? Number(cs2.opacity) : null, transform: cs2 ? cs2.transform : null }
    routeProbe.push({
      路由: r,
      '16ms': early,
      '106ms': late,
      有过渡: (early.opacity !== null && early.opacity < 0.99) || early.运行中动画 > 0
    })
    await sleep(420)
  }
  report.路由动效 = routeProbe
  location.hash = '#/search'
}

return JSON.stringify(report)
`

/* ------------------------------ 主流程 ------------------------------ */

/**
 * 进度驱动方式的直接代价 —— 用 CDP Performance 域量 LayoutCount / RecalcStyleCount。
 *
 * 这比「帧间隔」更能说明问题：帧间隔在快机器上会被 vsync 抹平，
 * 但「一次进度更新到底触发了多少次样式重算 + 布局」是骗不了人的。
 */
async function measureProgressLayouts(cdp) {
  try {
    await cdp.send('Performance.enable')
  } catch {
    return null
  }
  const snap = async () => {
    const r = await cdp.send('Performance.getMetrics')
    const m = {}
    for (const x of r.metrics) m[x.name] = x.value
    return {
      LayoutCount: m.LayoutCount ?? -1,
      RecalcStyleCount: m.RecalcStyleCount ?? -1
    }
  }
  await evaluate(
    cdp,
    `window.__mhBench = async (mode, n) => {
       const host = document.createElement('div')
       host.style.cssText = 'position:fixed;left:-99999px;top:0;width:200px;height:3px;overflow:hidden'
       host.innerHTML = '<i style="display:block;height:100%;width:100%;background:#f0c479"></i>'
       document.body.appendChild(host)
       const fill = host.querySelector('i')
       for (let i = 0; i < n; i += 1) {
         if (mode === 'width') {
           fill.style.transform = 'none'
           fill.style.width = (i % 100) + '%'
         } else {
           fill.style.width = '100%'
           fill.style.transformOrigin = 'left center'
           fill.style.transform = 'scaleX(' + (i % 100) / 100 + ')'
         }
         await new Promise((r) => requestAnimationFrame(r))
       }
       host.remove()
       return n
     }
     return 1`
  )
  const a0 = await snap()
  await evaluate(cdp, `return await window.__mhBench('width', 200)`)
  const a1 = await snap()
  await evaluate(cdp, `return await window.__mhBench('transform', 200)`)
  const a2 = await snap()
  const delta = (x, y) => ({
    LayoutCount: Math.round(y.LayoutCount - x.LayoutCount),
    RecalcStyleCount: Math.round(y.RecalcStyleCount - x.RecalcStyleCount)
  })
  return { 宽度驱动: delta(a0, a1), 变换驱动: delta(a1, a2) }
}

const page = await pickPage()
const cdp = await connect(page.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')
await cdp.send('Log.enable')

/* 需要审计特定视图时先切过去（列表页/播放页的漂移各不相同） */
if (AT) {
  await evaluate(
    cdp,
    `location.hash = ${JSON.stringify(AT)}
     await new Promise((r) => setTimeout(r, 1800))
     if (${JSON.stringify(AT)} === '#/search') {
       const input = document.querySelector('.search-box input')
       if (input) {
         const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
         setter.call(input, '周杰伦')
         input.dispatchEvent(new Event('input', { bubbles: true }))
         await new Promise((r) => setTimeout(r, 200))
         document.querySelector('.search-box button.primary')?.click()
         await new Promise((r) => setTimeout(r, 9000))
       }
     }
     return 1`
  )
}

const raw = await evaluate(
  cdp,
  `${SKIP_ROUTE ? 'window.__auditSkipRoute = true;' : 'window.__auditSkipRoute = false;'}\n${AUDIT_SRC}`
)
const report = JSON.parse(raw)

/* 进度的直接代价：200 次更新触发多少次样式重算 + 布局（CDP Performance 域） */
report.进度条驱动.布局计数 = await measureProgressLayouts(cdp)

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 1))
  cdp.close()
  process.exit(0)
}

const line = (label, value) => console.log(`  ${String(label).padEnd(26)} ${value}`)
const pct = (a, b) => (b === 0 ? '—' : `${((a / b) * 100).toFixed(1)}%`)

console.log(`\n设计审计  @127.0.0.1:${PORT}  （采样 ${report.采样元素数} 个可见元素）`)
console.log('='.repeat(72))

console.log('\n[1] 排版刻度')
line('字号种类', `${report.字号.种类} 种`)
line('字号明细', report.字号.明细.map((d) => `${d.value}×${d.count}`).join('  '))
line('字体族种类', `${report.字体族.种类} 种 → ${report.字体族.明细.map((d) => d.value).join(', ')}`)

console.log('\n[2] 调色板')
line('文字色种类', `${report.文字色.种类} 种`)
line('背景色种类', `${report.背景色.种类} 种`)
line('文字色明细', report.文字色.明细.slice(0, 6).map((d) => d.value).join('  '))

console.log('\n[3] 对比度（WCAG AA：正文 4.5 / 大字 3.0）')
line('检查文字元素', report.对比度.检查数)
line('不达标', `${report.对比度.不达标数}  (${pct(report.对比度.不达标数, report.对比度.检查数)} 失败率)`)
for (const f of report.对比度.不达标样例.slice(0, 6)) {
  console.log(`      ${String(f.ratio).padStart(5)} < ${f.need}  ${f.fontSize.padEnd(6)} ${f.selector}  「${f.text}」`)
}

console.log('\n[4] 间距网格（4px）')
line('检查的间距声明', report.间距.检查数)
line('离网声明', `${report.间距.离网总数}  (${pct(report.间距.离网总数, report.间距.检查数)} 离网率)`)
if (report.间距.跳过的auto值 > 0) {
  line('跳过的 auto 解析值', `${report.间距.跳过的auto值} 个（getComputedStyle 把 auto 解析成小数像素，不是作者写的值）`)
}
for (const d of report.间距.明细.slice(0, 6)) console.log(`      ${String(d.value).padEnd(26)} ×${d.count}  ${d.samples.join(', ')}`)

console.log('\n[5] 形状')
const rfmt = (list) => (list.length === 0 ? '无' : list.map((d) => `${d.value}×${d.count}`).join('  '))
const rTokens = report.圆角.刻度值
line(
  '契约刻度',
  `${rfmt(report.圆角.契约刻度)}   （--r-ctl ${rTokens.ctl} / --r-card ${rTokens.card}）`
)
if (report.圆角.媒体例外.length > 0) {
  line('已评估例外', `${rfmt(report.圆角.媒体例外)}   ← 媒体缩略图圆角（--r-media，用户明确要求，零圆角体系的唯一开口）`)
}
line('圆形（结构）', rfmt(report.圆角.圆形))
line('真漂移（应=0）', report.圆角.漂移.length === 0 ? '0 ✓' : rfmt(report.圆角.漂移))
line('阴影种类', `${report.阴影.种类} 种`)

console.log('\n[6] 命中区（WCAG 2.5.8 最小 24px）')
line('小于 24px 的可点元素', report.命中区.小于24px数量)
for (const t of report.命中区.样例.slice(0, 6)) console.log(`      ${t.size.padEnd(9)} ${t.tag}  「${t.title}」`)

console.log('\n[7] 动效')
line('有过渡的元素', report.动效.有过渡的元素数)
line('有动画(keyframes)的元素', report.动效.有动画的元素数)
line('时长种类', `${report.动效.时长种类} 种（口径：按解析后的**单值**去重，逗号列表已拆开）→ ${report.动效.时长明细.map((d) => d.value).join('  ')}`)
for (const d of report.动效.时长明细) {
  console.log(`         ${d.value.padEnd(8)} ×${String(d.count).padEnd(4)} 出现在: ${d.samples.join(', ') || '(未记录)'}`)
}
line('easing 种类', `${report.动效.easing种类} 种（同口径）`)
for (const e of report.动效.easing明细) {
  console.log(`         ${String(e.value).padEnd(34)} ×${String(e.count).padEnd(4)} 出现在: ${e.samples.join(', ') || '(未记录)'}`)
}
line('@keyframes 规则', report.动效.keyframes规则数)
line('prefers-reduced-motion 规则', `${report.动效.reducedMotion规则数}  ${report.动效.reducedMotion规则数 === 0 ? '← 缺失，动效无法降级' : ''}`)
line('样式表可读/被挡', `${report.动效.可读样式表} / ${report.动效.跨域被挡样式表}`)
line('布局属性动画（应=0）', report.动效.布局属性动画数)
for (const l of report.动效.布局属性动画样例) console.log(`      ✗ ${l.props.padEnd(10)} ${l.duration.padEnd(8)} ${l.selector}  ${l.size}`)
if (report.动效.已评估例外.length > 0) {
  line('已评估例外', `${report.动效.已评估例外.length} 处（团队裁决保留）`)
  for (const l of report.动效.已评估例外) console.log(`      · ${l.props.padEnd(10)} ${l.duration.padEnd(8)} ${l.selector}  ${l.size}`)
}

console.log('\n[8] 进度条更新成本')
const b = report.进度条驱动.微基准
line('单次更新+强制布局', `width ${b.宽度驱动_单次布局微秒}µs  vs  transform ${b.变换驱动_单次布局微秒}µs`)
line('连续更新中位帧间隔', `width ${b.宽度驱动_中位帧间隔ms}ms  vs  transform ${b.变换驱动_中位帧间隔ms}ms`)
const L = report.进度条驱动.布局计数
if (L) {
  const w = L.宽度驱动.LayoutCount
  const t = L.变换驱动.LayoutCount
  const cut = w > 0 ? Math.round((1 - t / w) * 100) : 0
  line('200 次更新触发布局', `width ${w} 次 / transform ${t} 次（少 ${cut}%）`)
  line('200 次更新重算样式', `width ${L.宽度驱动.RecalcStyleCount} 次 / transform ${L.变换驱动.RecalcStyleCount} 次`)
  line(
    '结论',
    cut >= 90
      ? `transform 驱动把布局从 ${w} 次压到 ${t} 次 —— 进度更新基本退出布局链路 ✓`
      : '差距不足 90%，需复查（可能仍有别的元素在改布局属性）'
  )
}
line('线上填充', report.进度条驱动.线上填充.length === 0 ? '(当前页面没有进度条)' : '')
for (const l of report.进度条驱动.线上填充) {
  console.log(`      ${String(l.selector).padEnd(16)} 过渡=${String(l.过渡属性).padEnd(10)} 变换驱动=${l.用变换驱动}  内联=${l.内联样式}`)
}

if (report.路由动效) {
  console.log('\n[9] 路由过渡（视图根元素在切换后 16ms / 106ms 的 opacity；opacity=1 且无动画 = 硬闪）')
  for (const r of report.路由动效) {
    console.log(
      `      ${r.路由.padEnd(12)} 16ms opacity=${String(r['16ms'].opacity).padEnd(5)} 动画=${String(r['16ms'].运行中动画).padEnd(3)} 106ms opacity=${String(r['106ms'].opacity).padEnd(5)} 有过渡=${r.有过渡 ? '✓' : '✗'}`
    )
  }
}

console.log('\n[10] emoji 当图标')
line('数量', report.emoji当图标.数量 + (report.emoji当图标.数量 ? ' → ' + report.emoji当图标.样例.join(', ') : ''))

const fails = []
if (report.字号.种类 > 8) fails.push(`字号 ${report.字号.种类} 种（约束 4-6）`)
if (report.字体族.种类 > 3) fails.push(`字体族 ${report.字体族.种类} 种（约束 ≤3：display / body / mono）`)
if (report.对比度.不达标数 > 0) fails.push(`对比度不达标 ${report.对比度.不达标数} 处`)
if (report.间距.离网总数 > 0) fails.push(`离网间距 ${report.间距.离网总数} 处`)
if (report.圆角.漂移.length > 0) {
  fails.push(`圆角漂移 ${report.圆角.漂移.map((d) => d.value + '×' + d.count).join('、')}（契约只有 --r-ctl/--r-card，媒体走 --r-media 例外）`)
}
if (report.命中区.小于24px数量 > 0) fails.push(`命中区 <24px ${report.命中区.小于24px数量} 个`)
if (report.动效.时长种类 > 4) fails.push(`动效时长 ${report.动效.时长种类} 种（约束 ≤4 token）`)
if (report.动效.reducedMotion规则数 === 0) fails.push('没有 prefers-reduced-motion 降级')
if (report.动效.布局属性动画数 > 0) fails.push(`动画了布局属性的元素 ${report.动效.布局属性动画数} 个（只准动 transform/opacity）`)
if (report.emoji当图标.数量 > 0) fails.push(`emoji 当图标 ${report.emoji当图标.数量} 处`)
if (report.路由动效 && report.路由动效.every((r) => !r.有过渡)) {
  fails.push('路由切换没有任何过渡')
}

console.log('\n' + '='.repeat(72))
if (fails.length === 0) {
  console.log('全部通过：没有量出来的规范漂移。')
} else {
  console.log(`需要处理 ${fails.length} 类问题：`)
  for (const f of fails) console.log(`  ✗ ${f}`)
}
console.log('')

cdp.close()
process.exit(fails.length > 0 ? 1 : 0)
