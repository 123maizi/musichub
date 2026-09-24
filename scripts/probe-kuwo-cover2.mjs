/**
 * 找酷我更好的封面来源。
 * r.s 那个老接口在部分关键词下 ALBUMID=0、封面全空；
 * 试试 www 接口（带 csrf）以及按 albumid 查专辑详情两条路。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
const KW = '周杰伦'

async function tryWwwApi() {
  console.log('\n[1] 酷我 www 接口')
  const landing = await fetch('http://www.kuwo.cn/', { headers: { 'User-Agent': UA } })
  const cookies = landing.headers.getSetCookie?.() ?? []
  const token = cookies.map((c) => /kw_token=([^;]+)/.exec(c)?.[1]).find(Boolean) ?? 'ABCDEFGHIJKLMNOP'
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ') || `kw_token=${token}`

  const url = `http://www.kuwo.cn/api/www/search/searchMusicBykeyWord?key=${encodeURIComponent(KW)}&pn=1&rn=20&httpsStatus=1`
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: 'http://www.kuwo.cn/search/list?key=' + encodeURIComponent(KW),
      Cookie: cookie,
      csrf: token
    }
  })
  const text = await r.text()
  console.log(`    HTTP ${r.status}  长度 ${text.length}`)
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    console.log(`    不是 JSON: ${text.slice(0, 120)}`)
    return null
  }

  const list = body?.data?.list ?? []
  console.log(`    返回 ${list.length} 条`)
  if (list.length === 0) {
    console.log(`    code=${body.code} msg=${body.msg ?? ''}`)
    return null
  }

  console.log('    第一条字段里的图片相关项：')
  for (const [k, v] of Object.entries(list[0])) {
    if (/pic|img|cover|photo/i.test(k)) console.log(`      ${k} = ${String(v).slice(0, 90)}`)
  }

  const withPic = list.filter((s) => s.pic || s.albumpic || s.albumPic).length
  console.log(`    有封面的: ${withPic}/${list.length}`)
  console.log('    前 5 条：')
  for (const s of list.slice(0, 5)) {
    console.log(
      `      ${String(s.name).slice(0, 14).padEnd(16)} albumId=${String(s.albumId ?? s.rid ?? '').padEnd(10)} pic=${String(s.pic ?? '').slice(0, 70)}`
    )
  }
  return list
}

async function testArtistPic() {
  console.log('\n[2] 用 web_artistpic_short 拼地址（歌手图，看看能不能用）')
  const url =
    `http://search.kuwo.cn/r.s?all=${encodeURIComponent(KW)}` +
    `&ft=music&itemset=web_2013&client=kt&pn=0&rn=5&rformat=json&encoding=utf8`
  const res = await fetch(url, {
    headers: { Referer: 'http://www.kuwo.cn/', 'User-Agent': UA, Cookie: 'kw_token=ABCDEFGHIJKLMNOP' }
  })
  const text = await res.text()
  const m = /web_artistpic_short':'([^']+)'/.exec(text)
  if (!m) {
    console.log('    没找到 web_artistpic_short')
    return
  }
  const short = m[1]
  console.log(`    原始值: ${short}`)
  for (const [label, u] of [
    ['img2.kuwo.cn/star/artistpic', `https://img2.kuwo.cn/star/artistpic/${short}`],
    ['img1.kuwo.cn/star/artistpic', `https://img1.kuwo.cn/star/artistpic/${short}`]
  ]) {
    try {
      const r = await fetch(u, { headers: { Referer: 'http://www.kuwo.cn/', 'User-Agent': UA } })
      const buf = Buffer.from(await r.arrayBuffer())
      const isJpg = buf[0] === 0xff && buf[1] === 0xd8
      console.log(`    ${label.padEnd(30)} HTTP ${r.status} ${(buf.length / 1024).toFixed(1)}KB ${isJpg ? 'JPEG' : '非图片'}`)
    } catch (e) {
      console.log(`    ${label} 失败: ${e.message.slice(0, 50)}`)
    }
  }
}

async function testKuwoCoverByRid() {
  console.log('\n[3] 按歌曲 rid 查详情（详情接口里可能有 album 封面）')
  const r = await fetch(
    `http://mobi.kuwo.cn/mobi.s?f=kuwo&q=${Buffer.from('user=0&corp=kuwo&source=kwplayer_ar_9.3.0.1&p2p=1&type=convert_url_with_sign&br=320kmp3&rid=' + '474678847').toString('base64')}`,
    { headers: { 'User-Agent': UA } }
  )
  const t = await r.text()
  console.log(`    HTTP ${r.status}  ${t.slice(0, 200)}`)
}

await tryWwwApi()
await testArtistPic()
await testKuwoCoverByRid()
console.log('\n' + '='.repeat(70))
