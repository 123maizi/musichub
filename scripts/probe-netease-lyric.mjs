/** 直接测网易云歌词链路（歌词的兜底源），确认它本身是否可用 */
const NETEASE_HEADERS = {
  Referer: 'https://music.163.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Cookie: 'appver=2.0.2; os=pc',
  Accept: 'application/json'
}

const songs = [
  { name: '告白气球', singer: '周杰伦' },
  { name: '晴天', singer: '周杰伦' },
  { name: '圣诞星', singer: '周杰伦' },
  { name: '稻香', singer: '周杰伦' }
]

for (const s of songs) {
  const keyword = `${s.name} ${s.singer.split(/[/、,，]/)[0]}`
  const t0 = Date.now()
  try {
    const res = await fetch('https://music.163.com/api/search/get', {
      method: 'POST',
      headers: { ...NETEASE_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ s: keyword, type: '1', offset: '0', limit: '5' }).toString(),
      signal: AbortSignal.timeout(10000)
    })
    const text = await res.text()
    let body = {}
    try {
      body = JSON.parse(text)
    } catch {
      /* ignore */
    }
    const list = body?.result?.songs ?? []
    const picked = list.find((i) => String(i.name).trim() === s.name) ?? list[0]
    let lyricLen = 0
    let lyricErr = null
    if (picked?.id) {
      const lres = await fetch(
        `https://music.163.com/api/song/lyric?id=${picked.id}&lv=1&kv=1&tv=-1`,
        { headers: NETEASE_HEADERS, signal: AbortSignal.timeout(10000) }
      )
      const lbody = JSON.parse(await lres.text())
      lyricLen = String(lbody?.lrc?.lyric ?? '').length
    }
    const ok = lyricLen > 20
    console.log(`${ok ? '✓' : '✗'} ${s.name} / ${s.singer}`)
    console.log(`   搜索 HTTP ${res.status}  命中 ${list.length}  选中「${picked?.name ?? '-'}」 歌词 ${lyricLen} 字  ${Date.now() - t0}ms`)
    if (!list.length) console.log(`   原文: ${text.slice(0, 140).replace(/\s+/g, ' ')}`)
  } catch (err) {
    console.log(`✗ ${s.name}  请求失败 (${Date.now() - t0}ms): ${err?.message ?? err}`)
  }
  console.log('')
}
