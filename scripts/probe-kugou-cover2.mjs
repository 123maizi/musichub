/**
 * 验证 union_cover 是不是真封面。
 * 顺便确认 {size} 该填多少（同时对比不同专辑的图是否不同 —— 这是判断
 * 「真封面」还是「统一占位图」的关键）。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'

async function search(kw) {
  const url =
    `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(kw)}` +
    '&page=1&pagesize=6&showtype=1'
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  const body = await res.json()
  return body?.data?.info ?? []
}

function unionCover(item) {
  try {
    const tp = typeof item.trans_param === 'string' ? JSON.parse(item.trans_param) : item.trans_param
    return tp?.union_cover ?? null
  } catch {
    return null
  }
}

console.log('\n酷狗 union_cover 实测')
console.log('='.repeat(76))

const items = await search('周杰伦')
console.log(`搜「周杰伦」返回 ${items.length} 条`)
let withCover = 0
for (const it of items) {
  const uc = unionCover(it)
  if (uc) withCover += 1
}
console.log(`其中带 union_cover 的: ${withCover}/${items.length}`)

/* 不同专辑的封面地址必须不同，否则还是占位图 */
console.log('\n不同歌曲的 union_cover（应当各不相同）：')
const seen = new Set()
for (const it of items.slice(0, 6)) {
  const uc = unionCover(it)
  const key = uc ? uc.replace('{size}', '300') : null
  if (key) seen.add(key)
  console.log(`  ${String(it.songname).slice(0, 14).padEnd(16)} ${uc ?? '（无）'}`)
}
console.log(`\n去重后剩 ${seen.size} 个不同地址 → ${seen.size > 1 ? '✓ 是各自的真封面' : '✗ 还是同一张'}`)

/* 试不同尺寸 */
console.log('\n尺寸实测（同一首歌）：')
const first = items.find((it) => unionCover(it))
if (first) {
  const raw = unionCover(first)
  for (const size of [150, 240, 300, 480, 800, 1000]) {
    const u = raw.replace('{size}', String(size))
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://www.kugou.com/' } })
      const buf = Buffer.from(await r.arrayBuffer())
      const isJpg = buf[0] === 0xff && buf[1] === 0xd8
      const isPng = buf[0] === 0x89 && buf[1] === 0x50
      // 读 JPEG 宽高
      let dim = ''
      if (isJpg) {
        let p = 2
        while (p + 9 < buf.length) {
          if (buf[p] !== 0xff) {
            p += 1
            continue
          }
          const marker = buf[p + 1]
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            dim = `${buf.readUInt16BE(p + 7)}x${buf.readUInt16BE(p + 5)}`
            break
          }
          p += 2 + buf.readUInt16BE(p + 2)
        }
      }
      console.log(
        `  size=${String(size).padEnd(5)} HTTP ${r.status}  ${(buf.length / 1024).toFixed(1)}KB  ${dim.padEnd(10)} ${isJpg ? 'JPEG' : isPng ? 'PNG' : '非图片'}`
      )
    } catch (e) {
      console.log(`  size=${size} 失败: ${e.message}`)
    }
  }
}

/* 再抽几个不同关键词，看覆盖率 */
console.log('\n覆盖率抽查：')
for (const kw of ['晴天', 'The Sound of Silence', '邓紫棋', 'Alan Walker']) {
  const list = await search(kw)
  const n = list.filter((it) => unionCover(it)).length
  console.log(`  「${kw}」 ${n}/${list.length}`)
}

console.log('='.repeat(76))
