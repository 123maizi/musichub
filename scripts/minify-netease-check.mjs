/**
 * 网易云搜索接口对照：应用用的 /api/search/get/web（带 Cookie）
 * vs 公开可用的 /api/search/get —— 判断「应用里网易 0 条」是外部接口变化还是压缩引起。
 * 全部从 Node 直连，不经过应用与压缩产物。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const kw = encodeURIComponent('周杰伦')

const variants = [
  {
    name: '应用当前实现 /api/search/get/web（带 Cookie appver）',
    url: `https://music.163.com/api/search/get/web?s=${kw}&type=1&offset=0&limit=30&total=true`,
    headers: { Referer: 'https://music.163.com/', 'User-Agent': UA, Cookie: 'appver=2.0.2; os=pc', Accept: 'application/json' }
  },
  {
    name: '对照 /api/search/get（同一套头）',
    url: `https://music.163.com/api/search/get?s=${kw}&type=1&offset=0&limit=30`,
    headers: { Referer: 'https://music.163.com/', 'User-Agent': UA, Cookie: 'appver=2.0.2; os=pc', Accept: 'application/json' }
  },
  {
    name: '对照 /api/search/get/web（不带 Cookie）',
    url: `https://music.163.com/api/search/get/web?s=${kw}&type=1&offset=0&limit=30&total=true`,
    headers: { Referer: 'https://music.163.com/', 'User-Agent': UA, Accept: 'application/json' }
  }
]

const out = []
for (const v of variants) {
  const t0 = Date.now()
  try {
    const res = await fetch(v.url, { headers: v.headers })
    const text = await res.text()
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      /* ignore */
    }
    const songs = parsed?.result?.songs ?? null
    out.push({
      name: v.name,
      status: res.status,
      ms: Date.now() - t0,
      bytes: text.length,
      code: parsed?.code ?? null,
      songCount: Array.isArray(songs) ? songs.length : null,
      first: Array.isArray(songs) && songs[0] ? songs[0].name : null,
      head: text.slice(0, 100).replace(/\s+/g, ' ')
    })
  } catch (err) {
    out.push({ name: v.name, error: String(err?.message ?? err).slice(0, 120) })
  }
}

console.log(JSON.stringify({ at: new Date().toISOString(), out }, null, 2))
