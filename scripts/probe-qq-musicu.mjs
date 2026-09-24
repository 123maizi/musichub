/** 看 musicu.fcg 的真实响应结构 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
const KW = '周杰伦'

const url =
  'https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=' +
  encodeURIComponent(
    JSON.stringify({
      comm: { ct: 24, cv: 0, v: '0.0.1' },
      req_1: {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: { query: KW, num_per_page: 5, page_num: 1, search_type: 0, grp: 1 }
      }
    })
  )

const r = await fetch(url, { headers: { Referer: 'https://y.qq.com/portal/player.html', 'User-Agent': UA } })
const text = await r.text()
const j = JSON.parse(text)

console.log('\nmusicu.fcg 响应结构')
console.log('='.repeat(78))
console.log(`顶层键: ${Object.keys(j).join(', ')}`)
console.log(`req_1 键: ${Object.keys(j.req_1 ?? {}).join(', ')}`)
console.log(`req_1.code = ${j.req_1?.code}`)

const data = j.req_1?.data
console.log(`data 类型: ${typeof data}`)
if (typeof data === 'string') {
  console.log(`data 是字符串，前 200 字符: ${data.slice(0, 200)}`)
} else if (data) {
  console.log(`data 键: ${Object.keys(data).join(', ')}`)
  const body = data.body
  console.log(`data.body 类型: ${typeof body}`)
  if (typeof body === 'string') {
    console.log(`body 是字符串（需要二次解析），前 200: ${body.slice(0, 200)}`)
    try {
      const inner = JSON.parse(body)
      console.log(`二次解析后键: ${Object.keys(inner).join(', ')}`)
      const songs = inner?.song?.list ?? []
      console.log(`歌曲 ${songs.length} 首`)
      if (songs[0]) {
        console.log('第一条字段:')
        for (const [k, v] of Object.entries(songs[0])) {
          console.log(`  ${k.padEnd(16)} = ${typeof v === 'object' ? JSON.stringify(v).slice(0, 90) : String(v).slice(0, 60)}`)
        }
      }
    } catch (e) {
      console.log(`二次解析失败: ${e.message}`)
    }
  } else if (body) {
    console.log(`body 键: ${Object.keys(body).join(', ')}`)
    const songs = body?.song?.list ?? []
    console.log(`歌曲 ${songs.length} 首`)
    if (songs[0]) {
      console.log('第一条关键字段:')
      for (const k of ['title', 'songname', 'mid', 'songmid', 'album', 'singer', 'interval']) {
        const v = songs[0][k]
        if (v !== undefined) {
          console.log(`  ${k.padEnd(12)} = ${typeof v === 'object' ? JSON.stringify(v).slice(0, 110) : String(v)}`)
        }
      }
    }
  }
}
console.log('='.repeat(78))
