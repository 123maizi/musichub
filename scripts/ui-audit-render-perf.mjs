/**
 * UI 改版前的只读审计（render-perf 负责的 6 个文件）。
 *
 * 目标：
 *  1. 列出所有硬编码视觉值：颜色 / 字号 / 间距 / 圆角 / 时长 / 阴影 / z-index
 *  2. 逐条判定 transition / animation 动了哪些属性，标出**触发布局**或
 *     硬约束里点名禁止的属性（width/height/top/left/margin/padding/box-shadow/background）
 *  3. 统计各文件的 :deep / 内联 style / @keyframes / reduced-motion 情况
 *
 * 用法： node scripts/ui-audit-render-perf.mjs [--json]
 */
import { readFileSync } from 'node:fs'

const FILES = [
  'src/renderer/src/components/SongTable.vue',
  'src/renderer/src/views/SearchView.vue',
  'src/renderer/src/views/LibraryView.vue',
  'src/renderer/src/views/AlbumView.vue',
  'src/renderer/src/views/ArtistView.vue',
  'src/renderer/src/views/SourceView.vue'
]

/** 硬约束里点名禁止参与动画的属性 */
const BANNED = [
  'width',
  'height',
  'top',
  'left',
  'right',
  'bottom',
  'margin',
  'margin-top',
  'margin-left',
  'margin-right',
  'margin-bottom',
  'padding',
  'padding-top',
  'padding-left',
  'padding-right',
  'padding-bottom',
  'box-shadow',
  'background',
  'background-color',
  'background-position',
  'background-size',
  'font-size',
  'line-height',
  'border-width',
  'border-radius',
  'gap',
  'flex',
  'flex-basis',
  'grid-template-columns',
  'max-height',
  'min-height',
  'text-indent'
]
/** 只 paint、不动布局，但严格按「只准 transform/opacity」也算越界，单独列出来请示 */
const PAINT_ONLY = ['color', 'border-color', 'fill', 'stroke', 'outline-color', 'text-decoration-color']

const count = (text, re) => (text.match(re) ?? []).length

function uniqValues(blocks, re, group = 1) {
  const set = new Map()
  for (const { line, text } of blocks) {
    const m = re.exec(text)
    if (m) {
      const v = m[group].trim()
      if (!set.has(v)) set.set(v, [])
      set.get(v).push(line)
    }
  }
  return set
}

const report = []

for (const file of FILES) {
  const raw = readFileSync(file, 'utf8')
  const styleMatch = /<style[^>]*>([\s\S]*?)<\/style>/.exec(raw)
  const styleStart = styleMatch ? raw.slice(0, styleMatch.index).split('\n').length : 0
  const styleBody = styleMatch ? styleMatch[1] : ''
  // 带行号的样式行
  const lines = styleBody.split('\n').map((text, i) => ({ line: styleStart + i, text }))

  const styleText = lines.map((l) => l.text).join('\n')

  const colors = new Set()
  const fonts = new Set()
  const radii = new Set()
  const spacing = new Set()
  const durations = new Set()
  const easings = new Set()
  const shadows = new Set()
  const zIndexes = new Set()

  for (const { text } of lines) {
    for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) colors.add(m[0].toLowerCase())
    for (const m of text.matchAll(/rgba?\([^)]*\)/g)) colors.add(m[0].replace(/\s+/g, ''))
    for (const m of text.matchAll(/font-size:\s*([^;]+)/g)) fonts.add(m[1].trim())
    for (const m of text.matchAll(/border-radius:\s*([^;]+)/g)) radii.add(m[1].trim())
    for (const m of text.matchAll(/(?:margin|padding)(?:-(?:top|right|bottom|left))?:\s*([^;]+)/g)) spacing.add(m[1].trim())
    for (const m of text.matchAll(/(?:transition|animation)[^:]*:\s*([^;]+)/g)) {
      for (const d of m[1].matchAll(/(\d*\.?\d+)(m?s)\b/g)) durations.add(d[0])
      for (const e of m[1].matchAll(/\b(linear|ease|ease-in|ease-out|ease-in-out|cubic-bezier\([^)]*\)|steps\([^)]*\))/g)) easings.add(e[0])
    }
    for (const m of text.matchAll(/box-shadow:\s*([^;]+)/g)) shadows.add(m[1].trim())
    for (const m of text.matchAll(/z-index:\s*([^;]+)/g)) zIndexes.add(m[1].trim())
  }

  // transition / animation 逐条判定
  const motions = []
  for (const { line, text } of lines) {
    const m = /(transition|animation)\s*:\s*([^;]+);/.exec(text)
    if (!m) continue
    const [, kind, value] = m
    // transition 的属性列表：取每段里时长之前的部分
    const props = kind === 'transition'
      ? value
          .split(',')
          .map((seg) => seg.trim().split(/\s+/)[0])
          .filter((p) => p && !/^\d/.test(p))
      : [value.trim().split(/\s+/)[0]]
    const banned = props.filter((p) => BANNED.some((b) => p === b || p.startsWith(b)))
    const paintOnly = props.filter((p) => PAINT_ONLY.includes(p))
    motions.push({
      line,
      kind,
      value: value.trim(),
      props,
      banned,
      paintOnly,
      verdict: banned.length > 0 ? '违反硬约束（触发布局/绘制）' : paintOnly.length > 0 ? '越界但仅 paint（需裁决）' : '合规（transform/opacity）'
    })
  }

  report.push({
    file,
    styleLines: lines.length,
    hasKeyframes: /@keyframes/.test(styleText),
    hasReducedMotion: /prefers-reduced-motion/.test(styleText),
    deepSelectors: count(styleText, /:deep\(/g),
    inlineStyleBindings: count(raw.slice(0, styleMatch?.index ?? raw.length), /:style="/g),
    transitionCount: count(styleText, /transition\s*:/g),
    animationCount: count(styleText, /animation\s*:/g),
    colors: [...colors],
    fonts: [...fonts],
    radii: [...radii],
    spacing: [...spacing],
    durations: [...durations],
    easings: [...easings],
    shadows: [...shadows],
    zIndexes: [...zIndexes],
    motions,
    violations: motions.filter((m) => m.banned.length > 0),
    paintOnlyMotions: motions.filter((m) => m.banned.length === 0 && m.paintOnly.length > 0)
  })
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2))
} else {
  let totalTransitions = 0
  let totalViolations = 0
  const allColors = new Set()
  const allFonts = new Set()
  const allRadii = new Set()
  const allDurations = new Set()
  const allEasings = new Set()
  const allSpacing = new Set()

  for (const r of report) {
    totalTransitions += r.transitionCount
    totalViolations += r.violations.length
    r.colors.forEach((c) => allColors.add(c))
    r.fonts.forEach((c) => allFonts.add(c))
    r.radii.forEach((c) => allRadii.add(c))
    r.durations.forEach((c) => allDurations.add(c))
    r.easings.forEach((c) => allEasings.add(c))
    r.spacing.forEach((c) => allSpacing.add(c))

    console.log(`\n═══ ${r.file} ═══`)
    console.log(`  样式行 ${r.styleLines} · transition ${r.transitionCount} · animation ${r.animationCount} · @keyframes ${r.hasKeyframes ? '有' : '无'} · prefers-reduced-motion ${r.hasReducedMotion ? '有' : '无'} · :deep ${r.deepSelectors} · 内联 :style 绑定 ${r.inlineStyleBindings}`)
    console.log(`  颜色(${r.colors.length}): ${r.colors.join(' ') || '（无）'}`)
    console.log(`  字号(${r.fonts.length}): ${r.fonts.join(' ') || '（无）'}`)
    console.log(`  圆角(${r.radii.length}): ${r.radii.join(' ') || '（无）'}`)
    console.log(`  时长(${r.durations.length}): ${r.durations.join(' ') || '（无）'}`)
    console.log(`  缓动(${r.easings.length}): ${r.easings.join(' ') || '（无）'}`)
    if (r.shadows.length) console.log(`  阴影(${r.shadows.length}): ${r.shadows.join(' | ')}`)
    if (r.zIndexes.length) console.log(`  z-index: ${r.zIndexes.join(' ')}`)
    if (r.motions.length) {
      console.log('  动效逐条:')
      for (const m of r.motions) {
        console.log(`    L${m.line} [${m.kind}] ${m.value}  → ${m.verdict}${m.banned.length ? `  ← 禁: ${m.banned.join(',')}` : ''}${m.paintOnly.length ? `  ← 仅paint: ${m.paintOnly.join(',')}` : ''}`)
      }
    } else {
      console.log('  动效逐条: （无）')
    }
  }

  console.log('\n══════════ 汇总 ══════════')
  console.log(`transition 总数: ${totalTransitions}   违反硬约束条数: ${totalViolations}`)
  console.log(`去重颜色 ${allColors.size} 种: ${[...allColors].join(' ')}`)
  console.log(`去重字号 ${allFonts.size} 种: ${[...allFonts].sort().join(' ')}`)
  console.log(`去重圆角 ${allRadii.size} 种: ${[...allRadii].join(' ')}`)
  console.log(`去重时长 ${allDurations.size} 种: ${[...allDurations].join(' ')}`)
  console.log(`去重缓动 ${allEasings.size} 种: ${[...allEasings].join(' ')}`)
  console.log(`去重间距值 ${allSpacing.size} 种: ${[...allSpacing].join(' | ')}`)
}
