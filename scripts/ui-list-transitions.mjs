/** 精确列出我 6 个文件里所有 transition 的行号与内容（UTF-8 直读，行号权威） */
import { readFileSync } from 'node:fs'

const FILES = [
  'src/renderer/src/components/SongTable.vue',
  'src/renderer/src/views/SearchView.vue',
  'src/renderer/src/views/LibraryView.vue',
  'src/renderer/src/views/AlbumView.vue',
  'src/renderer/src/views/ArtistView.vue',
  'src/renderer/src/views/SourceView.vue'
]

for (const f of FILES) {
  const lines = readFileSync(f, 'utf8').split('\n')
  const hits = []
  lines.forEach((text, i) => {
    if (/transition\s*:/.test(text)) hits.push(`${i + 1}: ${text.trim()}`)
  })
  console.log(`\n${f}  （共 ${lines.length} 行）`)
  for (const h of hits) console.log('   ' + h)
}
