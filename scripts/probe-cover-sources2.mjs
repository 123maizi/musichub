/**
 * 独立测两个补图来源（Node 直连，没有 CORS 限制）。
 * 目的：查清为什么酷我那些歌补不上封面。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
const KEYWORDS = ['蜗牛 周杰伦', '青花瓷 周杰伦', '夜曲 周杰伦', '告白气球 周杰伦']

async function testQq(keyword) {
  const url =
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=3` +
    `&w=${encodeURIComponent(keyword)}&format=json&cr=1&new_json=1`
  try {
    const r = await fetch(url, { headers: { Referer: 'https://y.qq.com/', 'User-Agent': UA } })
    const text = await r.text()
    if (r.status !== 200) return { status: r.status, note: text.slice(0, 80) }
    const j = JSON.parse(text)
    const list = j?.data?.song?.list ?? []
    return {
      status: r.status,
      songs: list.length,
      first: list[0]
        ? {
            title: list[0].title ?? list[0].songname,
            albumMid: list[0].album?.mid ?? null,
            singer: (list[0].singer ?? []).map((s) => s.name).join('/')
          }
        : null
    }
  } catch (e) {
    return { error: String(e.message).slice(0, 100) }
  }
}

async function testKugou(keyword) {
  const url =
    `http://mobilecdn.kugou.com/api/v3/search/song?format=json` +
    `&keyword=${encodeURIComponent(keyword)}&page=1&pagesize=3&showtype=1`
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } })
    const j = await r.json()
    const list = j?.data?.info ?? []
    let cover = null
    let parseNote = ''
    if (list[0]?.trans_param) {
      try {
        cover = JSON.parse(list[0].trans_param).union_cover ?? null
      } catch {
        parseNote = 'trans_param 解析失败'
      }
    }
    return {
      status: r.status,
      songs: list.length,
      first: list[0]
        ? { songname: list[0].songname, singername: list[0].singername, cover }
        : null,
      parseNote
    }
  } catch (e) {
    return { error: String(e.message).slice(0, 100) }
  }
}

console.log('\n补图来源实测')
console.log('='.repeat(78))
for (const kw of KEYWORDS) {
  console.log(`\n关键词「${kw}」`)
  const qq = await testQq(kw)
  console.log(`  QQ:    ${JSON.stringify(qq)}`)
  const kg = await testKugou(kw)
  console.log(`  酷狗:  ${JSON.stringify(kg)}`)
}
console.log('\n' + '='.repeat(78))
