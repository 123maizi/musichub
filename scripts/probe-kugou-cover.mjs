/**
 * 摸清酷狗搜索接口到底给了哪些封面字段。
 *
 * 背景：代码里酷狗的 picUrl 被硬编码成 undefined，注释说
 * 「stdmusic 那套地址对任何专辑都返回同一张占位图」。
 * 但那是最早那次探测的结论 —— 现在要重新查：
 * 是接口真的没给封面，还是我们把地址拼错了。
 */
const kw = '周杰伦 晴天'
const url =
  `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(kw)}` +
  '&page=1&pagesize=5&showtype=1'

const res = await fetch(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
    Referer: 'https://www.kugou.com/'
  }
})
const body = await res.json()
const list = body?.data?.info ?? []

console.log(`\n酷狗搜索返回 ${list.length} 条`)
console.log('='.repeat(76))

if (list.length === 0) {
  console.log('没有数据，原始响应：')
  console.log(JSON.stringify(body).slice(0, 800))
} else {
  console.log('第一条的全部字段：')
  const first = list[0]
  for (const [k, v] of Object.entries(first)) {
    const text = typeof v === 'object' ? JSON.stringify(v) : String(v)
    console.log(`  ${k.padEnd(22)} = ${text.slice(0, 110)}`)
  }

  console.log('\n所有条目里与封面/图片相关的字段：')
  const imgKeys = new Set()
  for (const item of list) {
    const flat = JSON.stringify(item)
    for (const m of flat.matchAll(/"(\w*(?:img|image|pic|cover|photo)\w*)"\s*:\s*"([^"]*)"/gi)) {
      imgKeys.add(`${m[1]} = ${m[2].slice(0, 80)}`)
    }
  }
  if (imgKeys.size === 0) {
    console.log('  （没有任何图片相关字段）')
  } else {
    for (const k of imgKeys) console.log(`  ${k}`)
  }

  console.log('\n试着拼几种已知的酷狗封面地址，看返回什么：')
  const cand = []
  const albumId = String(first.album_id ?? '')
  const imgField = String(first.imgurl ?? first.image ?? first.Image ?? '')
  if (albumId) {
    cand.push(['stdmusic/300 (album_id)', `https://imge.kugou.com/stdmusic/300/${albumId}.jpg`])
    cand.push(['mobilealbum/300 (album_id)', `https://imge.kugou.com/mobilealbum/300/${albumId}.jpg`])
    cand.push(['soft/collection/300', `https://imge.kugou.com/soft/collection/300/${albumId}.jpg`])
  }
  if (imgField) {
    cand.push(['stdmusic/300 (imgurl)', `https://imge.kugou.com/stdmusic/300/${imgField}`])
  }
  // 有的接口把封面放在 trans_param.union_cover
  const union = first.trans_param?.union_cover
  if (union) cand.push(['trans_param.union_cover', String(union)])

  for (const [label, u] of cand) {
    try {
      const r = await fetch(u, {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kugou.com/' }
      })
      const buf = Buffer.from(await r.arrayBuffer())
      const type = r.headers.get('content-type') ?? ''
      const isJpg = buf[0] === 0xff && buf[1] === 0xd8
      const isPng = buf[0] === 0x89 && buf[1] === 0x50
      console.log(
        `  ${label.padEnd(26)} HTTP ${r.status}  ${(buf.length / 1024).toFixed(1)}KB  ${type.slice(0, 20)}  ${isJpg ? 'JPEG' : isPng ? 'PNG' : '非图片'}`
      )
      console.log(`      ${u.slice(0, 100)}`)
    } catch (e) {
      console.log(`  ${label.padEnd(26)} 失败: ${e.message}`)
    }
  }
}
