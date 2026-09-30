/** 归属排查：剩余漂移（字号/圆角/时长/easing）分别落在谁的文件里 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]
  )
}

const MINE = new Set([
  'SongTable.vue',
  'SearchView.vue',
  'LibraryView.vue',
  'AlbumView.vue',
  'ArtistView.vue',
  'SourceView.vue'
])

const files = walk('src/renderer/src').filter((f) => /\.(vue|css)$/.test(f))
const rows = []
for (const f of files) {
  const name = f.split(/[\\/]/).pop()
  const s = readFileSync(f, 'utf8')
  const styleStart = s.indexOf('<style')
  const style = styleStart >= 0 ? s.slice(styleStart) : s
  const hits = []
  for (const m of style.matchAll(/font-size:\s*([^;]+);/g)) {
    if (!/var\(/.test(m[1]) && !/inherit|%|em\b/.test(m[1])) hits.push(`font-size:${m[1].trim()}`)
  }
  for (const m of style.matchAll(/border-radius:\s*([^;]+);/g)) {
    if (!/var\(/.test(m[1]) && !/50%|999|inherit|0\b/.test(m[1])) hits.push(`radius:${m[1].trim()}`)
  }
  for (const m of style.matchAll(/transition:\s*([^;]+);/g)) {
    if (/\d+m?s/.test(m[1])) hits.push(`transition:${m[1].replace(/\s+/g, ' ').slice(0, 60)}`)
  }
  for (const m of style.matchAll(/transition:\s*([^;]+);/g)) {
    if (/\b(ease|linear)\b/.test(m[1]) && !/cubic-bezier/.test(m[1])) hits.push(`easing裸值:${m[1].replace(/\s+/g, ' ').slice(0, 50)}`)
  }
  for (const m of style.matchAll(/font-family:\s*([^;]+);/g)) {
    if (!/var\(|inherit/.test(m[1])) hits.push(`font-family:${m[1].trim().slice(0, 50)}`)
  }
  if (hits.length) rows.push({ name, mine: MINE.has(name), hits })
}

console.log('=== 剩余字面量（按文件）===')
for (const r of rows) {
  console.log(`\n${r.mine ? '【我】' : '【他人】'} ${r.name}`)
  for (const h of [...new Set(r.hits)]) console.log('   ' + h)
}
const mineCount = rows.filter((r) => r.mine).reduce((s, r) => s + r.hits.length, 0)
const otherCount = rows.filter((r) => !r.mine).reduce((s, r) => s + r.hits.length, 0)
console.log(`\n我 6 个文件剩余字面量: ${mineCount}`)
console.log(`其它文件: ${otherCount}`)
