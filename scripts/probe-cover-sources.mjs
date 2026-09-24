/** 直接打 QQ 与酷狗的搜索，看补图为什么失败 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
const keyword = '蜗牛 周杰伦'
const out = {}

/* QQ */
try {
  const url =
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=3` +
    `&w=${encodeURIComponent(keyword)}&format=json&cr=1&new_json=1`
  const r = await fetch(url, { headers: { Referer: 'https://y.qq.com/', 'User-Agent': UA } })
  const text = await r.text()
  out.qq = {
    status: r.status,
    len: text.length,
    head: text.slice(0, 200)
  }
  try {
    const j = JSON.parse(text)
    const list = j?.data?.song?.list ?? []
    out.qq.songCount = list.length
    out.qq.first = list[0]
      ? {
          title: list[0].title ?? list[0].songname,
          albumMid: list[0].album?.mid ?? null,
          singer: (list[0].singer ?? []).map((s) => s.name).join('/')
        }
      : null
  } catch (e) {
    out.qq.parseError = String(e.message)
  }
} catch (e) {
  out.qq = { error: String(e.message).slice(0, 100) }
}

/* 酷狗 */
try {
  const url =
    `http://mobilecdn.kugou.com/api/v3/search/song?format=json` +
    `&keyword=${encodeURIComponent(keyword)}&page=1&pagesize=3&showtype=1`
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  const j = await r.json()
  const list = j?.data?.info ?? []
  out.kugou = {
    status: r.status,
    songCount: list.length,
    first: list[0]
      ? {
          songname: list[0].songname,
          singername: list[0].singername,
          hasTransParam: Boolean(list[0].trans_param),
          unionCover: (() => {
            try {
              return JSON.parse(list[0].trans_param ?? '{}').union_cover ?? null
            } catch {
              return '解析失败'
            }
          })()
        }
      : null
  }
} catch (e) {
  out.kugou = { error: String(e.message).slice(0, 100) }
}

return JSON.stringify(out, null, 1)
