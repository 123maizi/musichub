/**
 * 搜索接口可用性探针
 * 直接打五个平台的官方搜索接口，看哪些真的能返回数据。
 * 用途：接口会不定期变化，这个脚本是判断「哪条路还通」的最快手段。
 *
 * 运行： node scripts/probe-search.mjs [关键词]
 */
const KEYWORD = process.argv[2] ?? '周杰伦'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const targets = [
  {
    name: '酷我 kw',
    url: `http://search.kuwo.cn/r.s?all=${encodeURIComponent(KEYWORD)}&ft=music&itemset=web_2013&client=kt&pn=0&rn=30&rformat=json&encoding=utf8`,
    headers: { Referer: 'http://www.kuwo.cn/', Cookie: 'kw_token=ABCDEFGHIJKLMNOP' },
    pick: (b) => ({ count: (b?.abslist ?? []).length, first: b?.abslist?.[0]?.SONGNAME })
  },
  {
    name: '酷狗 kg',
    url: `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(KEYWORD)}&page=1&pagesize=30&showtype=1`,
    headers: {},
    pick: (b) => ({ count: b?.data?.info?.length ?? 0, first: b?.data?.info?.[0]?.songname })
  },
  {
    name: 'QQ tx',
    url: `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=30&w=${encodeURIComponent(KEYWORD)}&format=json&cr=1&new_json=1`,
    headers: { Referer: 'https://y.qq.com/' },
    pick: (b) => {
      const parsed = typeof b === 'string' ? tryJsonp(b) : b
      const list = parsed?.data?.song?.list ?? []
      return { count: list.length, first: list[0]?.title ?? list[0]?.songname }
    }
  },
  {
    name: '网易云 wy',
    url: `https://music.163.com/api/search/get/web?s=${encodeURIComponent(KEYWORD)}&type=1&offset=0&limit=30&total=true`,
    headers: { Referer: 'https://music.163.com/', Cookie: 'appver=2.0.2; os=pc' },
    pick: (b) => ({ count: b?.result?.songs?.length ?? 0, first: b?.result?.songs?.[0]?.name })
  },
  {
    name: '咪咕 mg',
    url: `https://m.music.migu.cn/migu/remoting/scr_search_tag?keyword=${encodeURIComponent(KEYWORD)}&type=2&rows=30&pgc=1`,
    headers: { Referer: 'https://m.music.migu.cn/' },
    pick: (b) => ({ count: b?.musics?.length ?? 0, first: b?.musics?.[0]?.songName })
  }
]

function tryJsonp(text) {
  const m = /^[\w$.]+\s*\(([\s\S]*)\)\s*;?$/.exec(text.trim())
  if (!m) return null
  try {
    return JSON.parse(m[1])
  } catch {
    return null
  }
}

const results = await Promise.all(
  targets.map(async (t) => {
    const started = Date.now()
    try {
      const res = await fetch(t.url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', ...t.headers },
        signal: AbortSignal.timeout(15000)
      })
      const text = await res.text()
      let body
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
      const info = t.pick(body)
      return { ...t, ok: res.ok, status: res.status, cost: Date.now() - started, ...info, snippet: text.slice(0, 120) }
    } catch (err) {
      return { ...t, ok: false, status: 0, cost: Date.now() - started, count: 0, error: err.message }
    }
  })
)

console.log(`\n搜索关键词: ${KEYWORD}\n${'='.repeat(72)}`)
for (const r of results) {
  const head = `${r.name.padEnd(10)} ${r.ok ? 'OK ' : 'FAIL'} http=${r.status} ${String(r.cost).padStart(5)}ms`
  if (r.count > 0) {
    console.log(`${head}  命中 ${String(r.count).padStart(3)} 条  首条: ${r.first ?? '(空)'}`)
  } else {
    console.log(`${head}  命中 0 条  ${r.error ?? ''}`)
    console.log(`           响应片段: ${String(r.snippet).replace(/\s+/g, ' ').slice(0, 100)}`)
  }
}
console.log('='.repeat(72))
