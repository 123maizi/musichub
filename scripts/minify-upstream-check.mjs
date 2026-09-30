/**
 * 直接从 Node（完全不经过应用与压缩产物）打 QQ / 网易 的搜索接口，
 * 判断「这两个平台 0 条」是外部 IP 限制还是压缩引起的。
 */
const UA_TX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const UA_WY = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

async function probe(name, url, headers) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, { headers })
    const text = await res.text()
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      /* 非 JSON（JSONP 或 HTML 拦截页） */
    }
    const jsonp = text.match(/^[^(]*\((.*)\)[;\s]*$/s)
    if (!parsed && jsonp) {
      try {
        parsed = JSON.parse(jsonp[1])
      } catch {
        /* ignore */
      }
    }
    const songList =
      parsed?.data?.song?.list ??
      parsed?.result?.songs ??
      parsed?.data?.list ??
      null
    return {
      name,
      status: res.status,
      ms: Date.now() - t0,
      contentType: res.headers.get('content-type'),
      bytes: text.length,
      isJson: !!parsed,
      head: text.slice(0, 120).replace(/\s+/g, ' '),
      songCount: Array.isArray(songList) ? songList.length : null,
      firstSong: Array.isArray(songList) && songList[0] ? (songList[0].songname ?? songList[0].name ?? null) : null
    }
  } catch (err) {
    return { name, error: String(err?.message ?? err).slice(0, 140), ms: Date.now() - t0 }
  }
}

const kw = encodeURIComponent('周杰伦')
const results = []
results.push(
  await probe(
    'QQ音乐 c.y.qq.com/soso/fcgi-bin/search_for_qq_cp',
    `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=1&n=30&w=${kw}&format=json&cr=1`,
    { 'User-Agent': UA_TX, Referer: 'https://y.qq.com/' }
  )
)
results.push(
  await probe(
    'QQ音乐 u.y.qq.com/cgi-bin/musicu.fcg(备用接口)',
    `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(
      JSON.stringify({
        comm: { ct: 19, cv: 1859 },
        req: {
          module: 'music.search.SearchCgiService',
          method: 'DoSearchForQQMusicDesktop',
          param: { query: '周杰伦', num_per_page: 30, page_num: 1 }
        }
      })
    )}`,
    { 'User-Agent': UA_TX, Referer: 'https://y.qq.com/' }
  )
)
results.push(
  await probe(
    '网易云 music.163.com/api/search/get',
    `https://music.163.com/api/search/get?s=${kw}&type=1&limit=30&offset=0`,
    { 'User-Agent': UA_WY, Referer: 'https://music.163.com/' }
  )
)

console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
