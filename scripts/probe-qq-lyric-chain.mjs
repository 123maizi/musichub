/** 一步步跑 QQ 歌词链，看是哪一步断了 */
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const QQ_HEADERS = {
  Referer: 'https://y.qq.com/portal/player.html',
  'User-Agent': DEFAULT_UA,
  Cookie: 'pgv_pvid=1; ts_uid=1'
}

const songs = [
  { name: '告白气球', singer: '周杰伦' },
  { name: '晴天', singer: '周杰伦' },
  { name: '圣诞星', singer: '周杰伦' }
]

const unwrap = (t) => t.replace(/^[^(]*\(/, '').replace(/\)\s*;?$/, '')

for (const s of songs) {
  console.log(`\n═══ ${s.name} / ${s.singer}`)
  const keyword = `${s.name} ${s.singer}`

  // 步骤 1：搜索
  const url =
    `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=1&n=3` +
    `&w=${encodeURIComponent(keyword)}&format=json&cr=1`
  const t0 = Date.now()
  const res = await fetch(url, { headers: { Referer: 'https://y.qq.com/', 'User-Agent': DEFAULT_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) })
  const text = await res.text()
  let list = []
  try {
    list = JSON.parse(unwrap(text))?.data?.song?.list ?? []
  } catch {
    /* ignore */
  }
  console.log(`  步骤1 搜索: HTTP ${res.status}  ${Date.now() - t0}ms  命中 ${list.length} 条`)
  if (!list.length) {
    console.log(`     原文: ${text.slice(0, 150).replace(/\s+/g, ' ')}`)
    continue
  }
  const picked = list.find((i) => String(i.title || i.songname).trim() === s.name) ?? list[0]
  const mid = String(picked.mid || picked.songmid || '')
  console.log(`     选中: ${picked.title || picked.songname} / mid=${mid}`)

  // 步骤 2：取歌词
  const lurl =
    `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(mid)}` +
    `&format=json&nobase64=1&g_tk=5381&loginUin=0&hostUin=0` +
    `&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`
  const t1 = Date.now()
  const lres = await fetch(lurl, { headers: QQ_HEADERS, signal: AbortSignal.timeout(10000) })
  const ltext = await lres.text()
  let body = {}
  try {
    body = JSON.parse(unwrap(ltext))
  } catch {
    /* ignore */
  }
  console.log(`  步骤2 歌词: HTTP ${lres.status}  ${Date.now() - t1}ms`)
  console.log(`     retcode=${body.retcode}  lyric长度=${String(body.lyric ?? '').length}  trans长度=${String(body.trans ?? '').length}`)
  if (!String(body.lyric ?? '').length) {
    console.log(`     原文: ${ltext.slice(0, 200).replace(/\s+/g, ' ')}`)
  } else {
    console.log(`     首行: ${String(body.lyric).split('\\n')[0].slice(0, 60)}`)
  }
}
