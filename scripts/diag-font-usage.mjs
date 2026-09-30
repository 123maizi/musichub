/** 查清两件事：谁能产生 mono 字体族；design-audit 的字体族统计口径 */
import { readFileSync } from 'node:fs'

const files = [
  'src/renderer/src/components/PlayerBar.vue',
  'src/renderer/src/views/DownloadView.vue',
  'src/renderer/src/views/NowPlayingView.vue',
  'src/renderer/src/views/SettingsView.vue',
  'src/renderer/src/views/SourceView.vue',
  'src/renderer/src/views/SearchView.vue',
  'src/renderer/src/components/SongTable.vue'
]
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  const classMono = (s.match(/class="[^"]*\bmono\b[^"]*"/g) ?? []).length
  const cssMono = (s.match(/font-family:\s*var\(--font-mono\)/g) ?? []).length
  const cssMonoOld = (s.match(/font-family:\s*var\(--mono\)/g) ?? []).length
  console.log(`${f.split('/').pop().padEnd(20)} class≈mono ${classMono}  cssMono ${cssMono}  cssMono(旧) ${cssMonoOld}`)
}

const a = readFileSync('scripts/design-audit.mjs', 'utf8')
const i = a.indexOf('const families')
console.log('\n--- design-audit 字体族统计 ---')
console.log(a.slice(Math.max(0, i - 300), i + 340))
