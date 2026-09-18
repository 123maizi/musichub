/**
 * 专辑搜索验证
 *
 * 直接跑真实的 search/album.ts，确认各平台的字段映射正确 ——
 * 这些接口字段名各不相同（酷我用 name/artist/hts_img，酷狗用 albumname/singername/imgurl），
 * 猜错一个就是空数组。
 *
 * 运行： npm run verify:album [专辑名]
 */
import { albumSearchers, ALBUM_PLATFORM_NAMES } from '../src/main/core/search/album'

const keyword = process.argv[2] ?? '叶惠美'

console.log(`\n专辑搜索验证 · 关键词「${keyword}」\n${'='.repeat(74)}`)

let okCount = 0
let withCover = 0
let totalAlbums = 0
const entries = Object.entries(albumSearchers)

for (const [id, searcher] of entries) {
  const started = Date.now()
  const label = ALBUM_PLATFORM_NAMES[id] ?? id
  try {
    const albums = await searcher(keyword, 1, 5)
    const cost = Date.now() - started
    if (albums.length > 0) okCount += 1
    totalAlbums += albums.length

    const covered = albums.filter((a) => a.picUrl).length
    withCover += covered

    console.log(`\n[${id}] ${label}  →  ${albums.length} 张 / ${cost}ms  （带封面 ${covered}）`)

    for (const album of albums.slice(0, 3)) {
      const extras: string[] = []
      if (album.songCount) extras.push(`${album.songCount} 首`)
      console.log(`     ${album.name} — ${album.singer || '(无歌手)'}${extras.length ? '  （' + extras.join(' / ') + '）' : ''}`)
      console.log(`        id=${album.albumId}  封面=${album.picUrl ? album.picUrl.slice(0, 78) : '无'}`)
    }
  } catch (err) {
    console.log(`\n[${id}] ${label}  →  失败`)
    console.log(`     ${err instanceof Error ? err.message : String(err)}`)
  }
}

console.log(`\n${'='.repeat(74)}`)
console.log(`汇总: ${okCount}/${entries.length} 个平台返回专辑，共 ${totalAlbums} 张，其中 ${withCover} 张带封面`)
console.log(`${'='.repeat(74)}\n`)
