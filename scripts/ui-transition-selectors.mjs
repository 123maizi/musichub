/** 打印每条 transition 所属的选择器（往上找最近的开块行） */
import { readFileSync } from 'node:fs'

const FILES = [
  'src/renderer/src/components/SongTable.vue',
  'src/renderer/src/views/SearchView.vue',
  'src/renderer/src/views/LibraryView.vue',
  'src/renderer/src/views/AlbumView.vue',
  'src/renderer/src/views/ArtistView.vue'
]

const BANNED = ['background', 'width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding', 'box-shadow', 'font-size', 'gap', 'border-radius']

for (const f of FILES) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((text, i) => {
    const m = /(transition|animation)\s*:\s*([^;]+);/.exec(text)
    if (!m) return
    let selector = '?'
    for (let j = i; j >= 0; j -= 1) {
      const t = lines[j]
      if (t.includes('{') && !t.trim().startsWith('@')) {
        selector = t.replace(/\{.*$/, '').trim()
        break
      }
      if (t.includes('{') && t.trim().startsWith('@')) {
        selector = t.trim()
        break
      }
    }
    const props = m[2]
      .split(',')
      .map((s) => s.trim().split(/\s+/)[0])
      .filter((p) => p && !/^\d/.test(p))
    const bad = props.filter((p) => BANNED.some((b) => p === b || p.startsWith(b)))
    const tag = bad.length ? `❌ 禁: ${bad.join(',')}` : '✅'
    console.log(`${f.split(/[\\/]/).pop()}:${i + 1}  ${selector}  →  ${m[2].trim()}   ${tag}`)
  })
}
