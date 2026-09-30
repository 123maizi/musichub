/**
 * 歌词上游直连对照（完全绕开应用与压缩产物）：
 * 复现 lyric/index.ts 的两条链路，看「没有歌词」到底是上游的原因还是压缩的原因。
 *   1) QQ: search_for_qq_cp 搜 songmid（应用首选）
 *   2) 网易: POST /api/search/get + 严格歌名/歌手匹配（应用备选）
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const targets = [
  { name: '晴天', singer: '周杰伦' },
  { name: '稻香', singer: '周杰伦' },
  { name: '一路向北', singer: '周杰伦' }
]

const VARIANT = ['cover', '翻唱', 'remix', '混音', 'dj', '伴奏', 'live', '现场', '深情', '治愈', '女声', '男声', 'ai', '版']

const out = []
for (const t of targets) {
  const kw = `${t.name} ${t.singer.split(/[/、,，]/)[0]}`

  // 1) QQ songmid 搜索
  let qq = null
  try {
    const url = `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=1&n=3&w=${encodeURIComponent(kw)}&format=json&cr=1`
    const res = await fetch(url, {
      headers: { Referer: 'https://y.qq.com/', 'User-Agent': UA, Accept: 'application/json' }
    })
    const text = await res.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      const m = /^[\w$.]+\s*\(([\s\S]*)\)\s*;?$/.exec(text.trim())
      if (m) {
        try {
          body = JSON.parse(m[1])
        } catch {
          /* ignore */
        }
      }
    }
    const list = body?.data?.song?.list ?? []
    qq = {
      status: res.status,
      bytes: text.length,
      listLen: list.length,
      first: list[0] ? `${list[0].songname ?? list[0].name} - ${list[0].singer?.[0]?.name ?? '?'}` : null,
      head: text.slice(0, 90).replace(/\s+/g, ' ')
    }
  } catch (err) {
    qq = { error: String(err?.message ?? err).slice(0, 120) }
  }

  // 2) 网易 POST + 严格匹配
  let wy = null
  try {
    const res = await fetch('https://music.163.com/api/search/get', {
      method: 'POST',
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent': UA,
        Cookie: 'appver=2.0.2; os=pc',
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ s: kw, type: '1', offset: '0', limit: '5' }).toString()
    })
    const text = await res.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      /* ignore */
    }
    const songs = body?.result?.songs ?? []
    const cands = songs.map((s) => ({
      name: s.name,
      artists: (s.artists ?? []).map((a) => a.name).join('/')
    }))
    const strict = cands.find(
      (c) =>
        (c.name === t.name || c.name.includes(t.name) || t.name.includes(c.name)) &&
        c.artists.includes(t.singer) &&
        !VARIANT.some((w) => c.name.toLowerCase().includes(w))
    )
    wy = { status: res.status, code: body?.code ?? null, count: songs.length, candidates: cands, strictMatch: strict ?? null }
  } catch (err) {
    wy = { error: String(err?.message ?? err).slice(0, 120) }
  }

  out.push({ target: kw, qq, netease: wy })
}

console.log(JSON.stringify({ at: new Date().toISOString(), out }, null, 2))
