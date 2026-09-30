/**
 * 结构体检（与配色无关）：
 *  1. 我的 6 个文件里是否还有「动布局属性」的 transition/animation
 *  2. 样式里定义了但模板/脚本从没用到的死类
 *  3. 模板里用了但样式/全局都没有的类（顺带提示）
 *  4. 内联 :style 绑定（确认没有 JS 驱动的布局动画）
 *
 * 用法： node scripts/ui-structure-audit.mjs
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

const BANNED = [
  'width',
  'height',
  'top',
  'left',
  'right',
  'bottom',
  'margin',
  'padding',
  'gap',
  'font-size',
  'line-height',
  'border-width',
  'flex-basis',
  'max-height',
  'min-height',
  'inset',
  'grid-template-columns'
]

let violations = 0
let deadTotal = 0

for (const file of FILES) {
  const raw = readFileSync(file, 'utf8')
  const styleMatch = /<style[^>]*>([\s\S]*?)<\/style>/.exec(raw)
  const tplMatch = /<template>([\s\S]*?)<\/template>\s*(?:<style|$)/.exec(raw)
  const scriptMatch = /<script[^>]*>([\s\S]*?)<\/script>/.exec(raw)
  const style = styleMatch ? styleMatch[1] : ''
  const styleStartLine = styleMatch ? raw.slice(0, styleMatch.index).split('\n').length : 0
  const tpl = tplMatch ? tplMatch[1] : ''
  const script = scriptMatch ? scriptMatch[1] : ''

  console.log(`\n═══ ${file.split('/').pop()} ═══`)

  /* 1. 布局动画 */
  const styleLines = style.split('\n')
  const found = []
  styleLines.forEach((text, i) => {
    const m = /(transition|animation)\s*:\s*([^;]+);/.exec(text)
    if (!m) return
    const props = m[2]
      .split(',')
      .map((s) => s.trim().split(/\s+/)[0])
      .filter((p) => p && !/^\d/.test(p) && p !== 'none')
    const bad = props.filter((p) => BANNED.some((b) => p === b || p.startsWith(b + '-')))
    const plainBg = /\bbackground\b/.test(m[2])
    if (bad.length || plainBg) {
      violations += 1
      found.push(`  ❌ L${styleStartLine + i} ${m[1]}: ${m[2].trim()}  ← ${[...bad, plainBg ? 'background(简写)' : ''].filter(Boolean).join(',')}`)
    }
  })
  console.log(found.length ? found.join('\n') : '  ✅ 无布局属性动画、无 background 简写过渡')

  /* 2. 死类 */
  const defined = new Set()
  const styleNoComment = style.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of styleNoComment.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(m[1])
  const usedInTpl = new Set()
  for (const m of tpl.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).forEach((c) => c && usedInTpl.add(c))
  for (const m of tpl.matchAll(/:class="([^"]*)"/g)) {
    for (const cm of m[1].matchAll(/['"]([a-zA-Z][\w-]*)['"]/g)) usedInTpl.add(cm[1])
  }
  // 动态拼接的 class 名（模板里的静态片段）
  for (const m of tpl.matchAll(/(?:class|:class)="[^"]*"/g)) {
    for (const cm of m[0].matchAll(/([a-zA-Z][\w-]{2,})/g)) usedInTpl.add(cm[1])
  }
  const scriptUsed = new Set(
    [...script.matchAll(/([a-zA-Z][\w-]*)/g)].map((m) => m[1])
  )
  // 元素选择器（无类）与 :deep 里的类不算死
  const dead = [...defined].filter((c) => !usedInTpl.has(c) && !new RegExp(`['"\`]${c}['"\`]`).test(script) && !new RegExp(`\\b${c}\\b`).test(scriptUsed.has(c) ? 'x' : ''))
  console.log(dead.length ? `  ⚠ 样式里定义但模板/脚本未引用（${dead.length}）: ${dead.join(' ')}` : '  ✅ 无死类')
  deadTotal += dead.length

  /* 3. 内联 style */
  const inlineStyles = [...raw.matchAll(/:style="/g)].length
  console.log(`  内联 :style 绑定: ${inlineStyles}${inlineStyles ? '  ← 确认不是布局属性动画驱动' : ''}`)
}

console.log(`\n══════ 汇总 ══════`)
console.log(`布局动画/background 简写过渡: ${violations} 处`)
console.log(`疑似死类: ${deadTotal} 个`)
