/**
 * 艺人搜索验证
 * 直接跑真实的 search/artist.ts 代码（不是复刻逻辑），确认五个平台的
 * 字段映射都对得上 —— 这些接口的字段名各不相同，猜错一个就是空数组。
 *
 * 运行： npm run verify:artist [歌手名]
 */
import { artistSearchers, ARTIST_PLATFORM_NAMES } from '../src/main/core/search/artist'

const keyword = process.argv[2] ?? '蛋堡'

console.log(`\n艺人搜索验证 · 关键词「${keyword}」\n${'='.repeat(74)}`)

let okCount = 0
let totalArtists = 0
const entries = Object.entries(artistSearchers)

for (const [id, searcher] of entries) {
  const started = Date.now()
  const label = ARTIST_PLATFORM_NAMES[id] ?? id
  try {
    const artists = await searcher(keyword, 1, 5)
    const cost = Date.now() - started
    if (artists.length > 0) okCount += 1
    totalArtists += artists.length

    console.log(`\n[${id}] ${label}  →  ${artists.length} 位 / ${cost}ms`)

    for (const artist of artists.slice(0, 3)) {
      const extras: string[] = []
      if (artist.alias) extras.push(`别名 ${artist.alias}`)
      if (artist.songCount) extras.push(`${artist.songCount} 首`)
      if (artist.albumCount) extras.push(`${artist.albumCount} 专辑`)

      console.log(`     ${artist.name}${extras.length ? '  （' + extras.join(' / ') + '）' : ''}`)
      console.log(`        id=${artist.artistId}  头像=${artist.picUrl ? '有' : '无'}`)
    }
  } catch (err) {
    console.log(`\n[${id}] ${label}  →  失败`)
    console.log(`     ${err instanceof Error ? err.message : String(err)}`)
  }
}

console.log(`\n${'='.repeat(74)}`)
console.log(`汇总: ${okCount}/${entries.length} 个平台返回艺人，共 ${totalArtists} 位`)
console.log(`${'='.repeat(74)}\n`)
