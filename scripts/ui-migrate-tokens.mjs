/**
 * UI 改版第一批：把 render-perf 名下 6 个文件里的硬编码视觉值机械地换成 token。
 *
 * 只做「一一映射」的安全替换，不做结构改动：
 *   1. 旧别名 var(--bg/--text/--line/--radius…) → 新 token
 *   2. font-size 字面量 → --fs-*（按契约：11/11.5/12→xs，12.5/13/13.5→sm，14→base，16→md，17/20→lg，25/26→xl）
 *   3. border-radius 字面量 → --r-ctl / --r-card / --r-pill（50% 圆形保留）
 *   4. padding / margin / gap 的 px 字面量 → 最近的 --sp-*（4/8/12/16/24/32/48/64）
 *   5. 硬编码颜色 → token 或 color-mix() 派生
 *   6. transition 时长字面量 → --dur-* + --ease-*
 *
 * 每处替换都打印出来，方便逐条复核。用法： node scripts/ui-migrate-tokens.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs'

const DRY = process.argv.includes('--dry')

const FILES = [
  'src/renderer/src/components/SongTable.vue',
  'src/renderer/src/views/SearchView.vue',
  'src/renderer/src/views/LibraryView.vue',
  'src/renderer/src/views/AlbumView.vue',
  'src/renderer/src/views/ArtistView.vue',
  'src/renderer/src/views/SourceView.vue'
]

/* 1. 旧别名 → 新 token（长键在前，避免 --bg 吃掉 --bg-elev） */
const VARS = [
  ['var(--bg-hover)', 'var(--surface-3)'],
  ['var(--bg-elev)', 'var(--surface-2)'],
  ['var(--bg-panel)', 'var(--surface-1)'],
  ['var(--bg)', 'var(--canvas)'],
  ['var(--line-soft)', 'var(--hairline-soft)'],
  ['var(--line)', 'var(--hairline)'],
  ['var(--text-dim)', 'var(--ink-muted)'],
  ['var(--text-faint)', 'var(--ink-tertiary)'],
  ['var(--text)', 'var(--ink)'],
  ['var(--radius-sm)', 'var(--r-ctl)'],
  ['var(--radius)', 'var(--r-card)']
]

/* 2. 字号 → --fs-*（按契约的就近归档） */
const FS = new Map([
  [9, '--fs-xs'],
  [10, '--fs-xs'],
  [11, '--fs-xs'],
  [11.5, '--fs-xs'],
  [12, '--fs-xs'],
  [12.5, '--fs-sm'],
  [13, '--fs-sm'],
  [13.5, '--fs-sm'],
  [14, '--fs-base'],
  [15, '--fs-base'],
  [16, '--fs-md'],
  [17, '--fs-lg'],
  [18, '--fs-lg'],
  [20, '--fs-lg'],
  [21, '--fs-xl'],
  [22, '--fs-xl'],
  [24, '--fs-xl'],
  [25, '--fs-xl'],
  [26, '--fs-xl']
])

/* 3. 圆角 */
const RADIUS = new Map([
  [2, '--r-ctl'],
  [3, '--r-ctl'],
  [4, '--r-ctl'],
  [6, '--r-ctl'],
  [8, '--r-ctl'],
  [9, '--r-card'],
  [10, '--r-card'],
  [12, '--r-card'],
  [14, '--r-card'],
  [16, '--r-card'],
  [18, '--r-pill'],
  [20, '--r-pill'],
  [999, '--r-pill']
])

/* 4. 间距刻度 */
const SP = [4, 8, 12, 16, 24, 32, 48, 64]
const spToken = (n) => {
  let best = SP[0]
  for (const s of SP) if (Math.abs(s - n) < Math.abs(best - n)) best = s
  return `--sp-${SP.indexOf(best) + 1}`
}

/* 5. 硬编码颜色 → token / color-mix */
const COLORS = [
  ['rgba(212, 162, 76, 0.3)', 'color-mix(in srgb, var(--accent) 30%, transparent)'],
  ['rgba(212,162,76,0.3)', 'color-mix(in srgb, var(--accent) 30%, transparent)'],
  ['#e0bd7a', 'var(--accent-bright)'],
  ['rgba(212, 87, 76, 0.3)', 'color-mix(in srgb, var(--danger) 30%, transparent)'],
  ['rgba(212,87,76,0.3)', 'color-mix(in srgb, var(--danger) 30%, transparent)'],
  ['rgba(212, 87, 76, 0.25)', 'color-mix(in srgb, var(--danger) 25%, transparent)'],
  ['rgba(212,87,76,0.25)', 'color-mix(in srgb, var(--danger) 25%, transparent)'],
  ['rgba(212, 87, 76, 0.08)', 'color-mix(in srgb, var(--danger) 8%, transparent)'],
  ['rgba(212,87,76,0.08)', 'color-mix(in srgb, var(--danger) 8%, transparent)'],
  ['rgba(212, 87, 76, 0.05)', 'color-mix(in srgb, var(--danger) 5%, transparent)'],
  ['rgba(212,87,76,0.05)', 'color-mix(in srgb, var(--danger) 5%, transparent)'],
  ['#e79a92', 'var(--danger)'],
  ['#33333e', 'var(--hairline-strong)'],
  ['0 8px 24px rgba(0, 0, 0, 0.4)', 'var(--shadow-2)'],
  ['0 8px 24px rgba(0,0,0,0.4)', 'var(--shadow-2)'],
  ['0 14px 36px rgba(0, 0, 0, 0.4)', 'var(--shadow-2)'],
  ['0 12px 32px rgba(0, 0, 0, 0.35)', 'var(--shadow-2)']
]

/* 6. 过渡时长 + easing */
const DUR = [
  ['0.1s', 'var(--dur-1) var(--ease-out)'],
  ['0.12s', 'var(--dur-1) var(--ease-out)'],
  ['0.14s', 'var(--dur-1) var(--ease-out)'],
  ['0.16s', 'var(--dur-2) var(--ease-out)'],
  ['0.18s', 'var(--dur-2) var(--ease-out)'],
  ['0.2s', 'var(--dur-2) var(--ease-out)'],
  ['0.25s', 'var(--dur-3) var(--ease-out)']
]

const log = []
let totalEdits = 0

for (const file of FILES) {
  const original = readFileSync(file, 'utf8')
  const lines = original.split('\n')
  let edits = 0

  const apply = (text, from, to, lineNo, kind) => {
    if (!text.includes(from)) return text
    const count = text.split(from).length - 1
    edits += count
    log.push({ file, line: lineNo, kind, from, to, count })
    return text.split(from).join(to)
  }

  const out = lines.map((text, i) => {
    let t = text

    // 只在样式相关的行上动（避免碰到模板/脚本里的字符串）
    const inStyleBlock = (() => {
      // 粗略判断：本行是否处于 <style> 之后
      const upto = lines.slice(0, i).join('\n')
      const open = (upto.match(/<style/g) ?? []).length
      const close = (upto.match(/<\/style>/g) ?? []).length
      return open > close
    })()
    if (!inStyleBlock) return t

    for (const [from, to] of VARS) t = apply(t, from, to, i + 1, 'var')
    for (const [from, to] of COLORS) t = apply(t, from, to, i + 1, 'color')
    for (const [from, to] of DUR) t = apply(t, from, to, i + 1, 'dur')

    // font-size
    t = t.replace(/font-size:\s*([\d.]+)px/g, (m, n) => {
      const tok = FS.get(Number(n))
      if (!tok) return m
      edits += 1
      log.push({ file, line: i + 1, kind: 'fs', from: `${n}px`, to: `var(${tok})`, count: 1 })
      return `font-size: var(${tok})`
    })

    // border-radius
    t = t.replace(/border-radius:\s*([\d.]+)px/g, (m, n) => {
      const tok = RADIUS.get(Number(n))
      if (!tok) return m
      edits += 1
      log.push({ file, line: i + 1, kind: 'radius', from: `${n}px`, to: `var(${tok})`, count: 1 })
      return `border-radius: var(${tok})`
    })

    // padding / margin / gap 的 px → --sp-*
    t = t.replace(
      /((?:padding|margin)(?:-(?:top|right|bottom|left))?|row-gap|column-gap|gap):\s*([^;{}]+);/g,
      (m, prop, value) => {
        if (!/\d+(?:\.\d+)?px/.test(value)) return m
        const converted = value.replace(/([\d.]+)px/g, (mm, n) => {
          const num = Number(n)
          if (num === 0) return '0'
          edits += 1
          const tok = spToken(num)
          log.push({ file, line: i + 1, kind: 'sp', from: `${n}px`, to: `var(${tok})`, count: 1 })
          return `var(${tok})`
        })
        return `${prop}: ${converted};`
      }
    )

    return t
  })

  let result = out.join('\n')
  result = result.replace(/\n{3,}/g, '\n\n')
  if (!DRY && result !== original) writeFileSync(file, result)
  totalEdits += edits
  console.log(`${file}: ${edits} 处替换`)
}

console.log(`\n合计 ${totalEdits} 处${DRY ? '（dry-run，未写盘）' : ''}`)
const byKind = {}
for (const l of log) byKind[l.kind] = (byKind[l.kind] ?? 0) + l.count
console.log('分类:', JSON.stringify(byKind))
console.log('\n--- 明细 ---')
for (const l of log) {
  console.log(`${l.file.split('/').pop()}:${l.line} [${l.kind}] ${l.from} → ${l.to}${l.count > 1 ? ` ×${l.count}` : ''}`)
}
