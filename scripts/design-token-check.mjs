/**
 * 设计 token 的对比度验算。
 *
 * 为什么单独跑一遍：颜色是不是「够亮」不能靠眼睛看暗色界面 —— 必须算 WCAG 对比度。
 * 这个脚本把候选 token 在每一种背景上算一遍，只有达标的组合才写进 style.css。
 * 团队里任何人改配色都可以先跑它。
 *
 * 用法：node scripts/design-token-check.mjs
 */
const hex = (h) => {
  const s = h.replace('#', '')
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: 1 }
}
const lum = (c) => {
  const f = (v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}
const ratio = (a, b) => {
  const l1 = lum(a)
  const l2 = lum(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** 画布与表面（大理石暖白体系） */
const SURFACES = {
  canvas: '#F7F5F1',
  'surface-1': '#FFFFFF',
  'surface-2': '#FCFBF8',
  'surface-3': '#F1EEE8',
  'surface-4': '#E8E4DC'
}

/** 文字层级：前三级都要能当正文用（AA ≥4.5） */
const INK = {
  ink: '#1C1A17',
  'ink-muted': '#6B655C',
  'ink-subtle': '#736C62',
  'ink-faint(装饰)': '#A39C90'
}

/** 强调色候选（用户还没定，三个都算一遍好让决策有数） */
const ACCENT = {
  '青铜金 #8A6B3F': '#8A6B3F',
  '赤陶红 #A64B32': '#A64B32',
  'Ins蓝 #0095F6': '#0095F6'
}

/** 语义色 */
const SEMANTIC = {
  'ok #2F7D4F': '#2F7D4F',
  'danger #A8342C': '#A8342C'
}

console.log('对比度矩阵（行 = 前景，列 = 背景）')
console.log('AA 门槛：正文 4.5，大字/图形 3.0\n')

const nameW = 15
const cellW = 13
const header = ' '.repeat(nameW) + Object.keys(SURFACES).map((s) => s.padStart(cellW)).join('')
console.log(header)
console.log('-'.repeat(header.length))

const checks = []
function row(label, color, need = 4.5) {
  let line = label.padEnd(nameW)
  for (const [sname, sval] of Object.entries(SURFACES)) {
    const r = ratio(hex(color), hex(sval))
    const ok = r >= need
    checks.push({ fg: label, bg: sname, ratio: r, need, ok })
    line += `${(r.toFixed(2) + (ok ? ' ✓' : ' ✗')).padStart(cellW)}`
  }
  console.log(line)
}

for (const [k, v] of Object.entries(INK)) row(`${k} ${v}`, v, 4.5)
for (const [k, v] of Object.entries(ACCENT)) row(`${k} ${v}`, v, 4.5)
for (const [k, v] of Object.entries(SEMANTIC)) row(`${k} ${v}`, v, 4.5)
row('hairline #23232b', '#23232b', 1.2)

const bad = checks.filter((c) => !c.ok && c.need === 4.5)
console.log('\n' + '='.repeat(60))
if (bad.length === 0) {
  console.log('全部达标：这些 token 组合可以写进 style.css')
} else {
  console.log(`有 ${bad.length} 个组合不达标：`)
  for (const b of bad) console.log(`  ${b.fg} on ${b.bg}: ${b.ratio.toFixed(2)} < ${b.need}`)
}
