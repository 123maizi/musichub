/** 看清两个可用 QQ 接口的字段结构 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
const KW = '周杰伦'

console.log('\n[1] smartbox_new.fcg 结构')
console.log('='.repeat(78))
{
  const url = `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=${encodeURIComponent(KW)}&format=json`
  const r = await fetch(url, { headers: { Referer: 'https://y.qq.com/', 'User-Agent': UA } })
  const j = await r.json()
  const list = j?.data?.song?.itemlist ?? []
  console.log(`歌曲 ${list.length} 首`)
  if (list[0]) {
    console.log('第一条全部字段：')
    for (const [k, v] of Object.entries(list[0])) console.log(`  ${k.padEnd(16)} = ${String(v).slice(0, 70)}`)
    console.log('\n前 4 条：')
    for (const s of list.slice(0, 4)) {
      console.log(`  ${s.name}  singer=${s.singer}  mid=${s.mid}  albumMid=${s.albumMid}`)
    }
  }
}

console.log('\n[2] search_for_qq_cp 结构')
console.log('='.repeat(78))
{
  const url = `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?w=${encodeURIComponent(KW)}&format=json&n=5&p=1&cr=1&new_json=1`
  const r = await fetch(url, { headers: { Referer: 'https://y.qq.com/', 'User-Agent': UA } })
  const j = await r.json()
  const list = j?.data?.song?.list ?? []
  console.log(`歌曲 ${list.length} 首`)
  if (list[0]) {
    console.log('第一条关键字段：')
    for (const k of ['title', 'songname', 'songmid', 'mid', 'album', 'singer', 'interval']) {
      const v = list[0][k]
      console.log(`  ${k.padEnd(12)} = ${typeof v === 'object' ? JSON.stringify(v).slice(0, 110) : String(v).slice(0, 70)}`)
    }
    console.log('\n前 4 条（专辑 mid 用于拼封面）：')
    for (const s of list.slice(0, 4)) {
      const albumMid = s.album?.mid ?? s.albumMid ?? '?'
      const singers = (s.singer ?? []).map((x) => x.name).join('/')
      console.log(`  ${String(s.title ?? s.songname).slice(0, 16).padEnd(18)} ${singers.slice(0, 14).padEnd(16)} albumMid=${albumMid}`)
    }
    console.log('\n验证封面地址：')
    const albumMid = list[0]?.album?.mid
    if (albumMid) {
      const u = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
      const ir = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' } })
      const buf = Buffer.from(await ir.arrayBuffer())
      const ok = buf[0] === 0xff && buf[1] === 0xd8
      console.log(`  ${u}`)
      console.log(`  HTTP ${ir.status}  ${(buf.length / 1024).toFixed(1)}KB  ${ok ? 'JPEG ✓ 是真封面' : '非图片'}`)
    }
  }
}
console.log('='.repeat(78))
