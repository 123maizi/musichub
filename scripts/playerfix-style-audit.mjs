/**
 * player-fix 专用：审计「播放器与弹层」三个文件的样式硬编码情况。
 *
 * 输出（JSON）：
 *   · 非 token 颜色 / 已用 token 清单
 *   · 字号、间距（是否落在 4px 网格）、圆角、阴影
 *   · transition / animation 的时长与 easing 种类
 *   · ⚠️ 动画了布局属性的地方（width/height/top/left/margin/padding/box-shadow/background…）
 *   · transform/opacity 驱动的过渡数量、will-change、@keyframes、reduced-motion
 *
 * 用法：node scripts/playerfix-style-audit.mjs [文件...]
 */
import { readFileSync, existsSync } from 'node:fs'

const FILES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'src/renderer/src/components/PlayerBar.vue',
      'src/renderer/src/views/NowPlayingView.vue',
      'src/renderer/src/components/PlaylistMenu.vue'
    ]

/** 动画这些属性会触发布局/绘制，是要重点清理的对象 */
const LAYOUT_PROPS = [
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'top', 'left', 'right', 'bottom', 'inset',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-width', 'border-color',
  'box-shadow', 'background', 'background-color', 'background-position',
  'font-size', 'line-height', 'flex', 'flex-basis', 'gap', 'all'
]

function styleBlocks(src) {
  const out = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let m
  while ((m = re.exec(src))) out.push(m[1])
  return out
}

/** 把 CSS 文本切成规则块，带上选择器，便于定位 */
function rules(css) {
  const out = []
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(clean))) {
    const sel = m[1].trim().replace(/\s+/g, ' ')
    if (sel.startsWith('@')) {
      // at-rule（如 @media / @keyframes）内部再拆一层
      const inner = m[2]
      const re2 = /([^{}]+)\{([^{}]*)\}/g
      let m2
      while ((m2 = re2.exec(inner))) {
        out.push({ selector: `${sel} ${m2[1].trim().replace(/\s+/g, ' ')}`, body: m2[2], at: sel })
      }
      if (!re2.test(inner) && !/\{/.test(inner)) out.push({ selector: sel, body: inner, at: sel })
      continue
    }
    out.push({ selector: sel, body: m[2], at: null })
  }
  return out
}

const declRe = /([a-zA-Z-]+)\s*:\s*([^;{}]+)/g

function analyze(file) {
  const src = readFileSync(file, 'utf8')
  const css = styleBlocks(src).join('\n')
  const rs = rules(css)

  const colors = new Map()
  const fontSizes = new Map()
  const spacings = new Map()
  const radii = new Map()
  const shadows = new Map()
  const durations = new Map()
  const easings = new Map()
  const tokensUsed = new Map()
  const layoutAnimated = []
  const propsAnimated = new Map()
  let transformTransitions = 0
  let opacityTransitions = 0
  let willChange = 0
  let keyframes = 0
  let reducedMotion = 0
  let transitionDecls = 0

  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1)

  for (const r of rs) {
    if (/@keyframes/.test(r.at ?? '')) keyframes += 1
    if (/prefers-reduced-motion/.test(r.at ?? '')) reducedMotion += 1
    if (/will-change/.test(r.body)) willChange += 1

    declRe.lastIndex = 0
    let d
    while ((d = declRe.exec(r.body))) {
      const prop = d[1].toLowerCase()
      const value = d[2].trim()

      // 颜色（排除 var() 里的）
      const colorHits = value.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) ?? []
      for (const c of colorHits) if (!value.includes(`var(${c}`)) bump(colors, `${prop}: ${c}`)
      for (const t of value.match(/var\((--[a-z0-9-]+)/g) ?? []) bump(tokensUsed, t.slice(4))

      if (prop === 'font-size') bump(fontSizes, value)
      if (/^(padding|margin|gap|row-gap|column-gap)(-top|-right|-bottom|-left)?$/.test(prop)) {
        for (const part of value.split(/\s+/)) if (/^-?[\d.]+px$/.test(part)) bump(spacings, part)
      }
      if (prop === 'border-radius') bump(radii, value)
      if (prop === 'box-shadow') bump(shadows, value)

      if (prop === 'transition' || prop.startsWith('transition')) {
        transitionDecls += 1
        // transition: a 140ms ease, b 200ms cubic-bezier(...)
        for (const part of value.split(',')) {
          const p = part.trim()
          const propName = (p.split(/\s+/)[0] ?? '').toLowerCase()
          if (propName) bump(propsAnimated, propName)
          for (const t of p.match(/\b[\d.]+m?s\b/g) ?? []) bump(durations, t)
          for (const e of p.match(/cubic-bezier\([^)]*\)|\b(?:ease|ease-in|ease-out|ease-in-out|linear|steps\([^)]*\))\b/g) ?? [])
            bump(easings, e)
          if (propName === 'transform') transformTransitions += 1
          if (propName === 'opacity') opacityTransitions += 1
          if (LAYOUT_PROPS.includes(propName)) {
            layoutAnimated.push({ file, selector: r.selector, prop: propName, decl: `transition: ${p}` })
          }
        }
      }
      if (prop === 'animation' || prop === 'animation-name') {
        for (const t of value.match(/\b[\d.]+m?s\b/g) ?? []) bump(durations, t)
      }
    }
  }

  const spacingOffGrid = [...spacings.entries()].filter(([v]) => {
    const n = parseFloat(v)
    return Number.isFinite(n) && n % 4 !== 0 && n !== 0
  })

  const sortMap = (m) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]))

  return {
    文件: file,
    样式规则数: rs.length,
    声明数: (css.match(declRe) ?? []).length,
    非token颜色种类: colors.size,
    非token颜色: sortMap(colors),
    已用token: sortMap(tokensUsed),
    字号种类: fontSizes.size,
    字号: sortMap(fontSizes),
    间距种类: spacings.size,
    间距: sortMap(spacings),
    间距不在4px网格: spacingOffGrid,
    圆角种类: radii.size,
    圆角: sortMap(radii),
    阴影种类: shadows.size,
    阴影: sortMap(shadows),
    transition声明数: transitionDecls,
    时长种类: durations.size,
    时长: sortMap(durations),
    easing种类: easings.size,
    easing: sortMap(easings),
    动画属性种类: propsAnimated.size,
    动画属性: sortMap(propsAnimated),
    动transform的过渡: transformTransitions,
    动opacity的过渡: opacityTransitions,
    willChange处数: willChange,
    keyframes数: keyframes,
    reducedMotion覆盖: reducedMotion,
    '⚠️动画了布局属性': layoutAnimated
  }
}

const report = { 生成时间: new Date().toISOString(), 文件: [] }
for (const f of FILES) {
  if (!existsSync(f)) {
    report.文件.push({ 文件: f, 错误: '文件不存在' })
    continue
  }
  report.文件.push(analyze(f))
}

/* 汇总：合并三个文件的「布局属性动画」清单，这是最需要先看的部分 */
const allLayout = report.文件.flatMap((f) => f['⚠️动画了布局属性'] ?? [])
report.汇总 = {
  文件数: report.文件.length,
  非token颜色种类合计: report.文件.reduce((n, f) => n + (f.非token颜色种类 ?? 0), 0),
  字号种类合计: new Set(report.文件.flatMap((f) => Object.keys(f.字号 ?? {}))).size,
  时长种类合计: new Set(report.文件.flatMap((f) => Object.keys(f.时长 ?? {}))).size,
  '⚠️布局属性动画处数': allLayout.length,
  '⚠️布局属性动画明细': allLayout
}

console.log(JSON.stringify(report, null, 1))
