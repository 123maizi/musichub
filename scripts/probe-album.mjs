/**
 * 专辑搜索接口探测
 *
 * 动手写专辑搜索之前，先确认五个平台的专辑接口各自是否可用、字段长什么样。
 * 艺人搜索时的教训：这些接口的字段名一个都没猜对，必须先看真实返回。
 *
 * 运行： node scripts/probe-album.mjs [专辑名]
 */
const KEYWORD = process.argv[2] ?? '叶惠美'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/** 酷我返回单引号字面量，需要宽松解析 */
function parseLooseJson(text) {
  let out = ''
  let i = 0
  let inStr = false
  let quote = ''
  while (i < text.length) {
    const ch = text[i]
    if (!inStr) {
      if (ch === "'" || ch === '"') {
        inStr = true
        quote = ch
        out += '"'
        i++
        continue
      }
      out += ch
      i++
      continue
    }
    if (ch === '\\') {
      const next = text[i + 1]
      if (next === "'") { out += "'"; i += 2; continue }
      if (next === '"') { out += '\\"'; i += 2; continue }
      out += ch + (next ?? '')
      i += 2
      continue
    }
    if (ch === quote) { inStr = false; out += '"'; i++; continue }
    if (quote === "'" && ch === '"') { out += '\\"'; i++; continue }
    out += ch
    i++
  }
  return JSON.parse(out.replace(/,\s*([}\]])/g, '$1'))
}

async function get(url, headers = {}) {
  const started = Date.now()
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, ...headers },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow'
    })
    return { status: res.status, text: await res.text(), cost: Date.now() - started }
  } catch (err) {
    return { status: 0, text: '', cost: Date.now() - started, error: err.message }
  }
}

async function post(url, body, headers = {}) {
  const started = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(15000)
    })
    return { status: res.status, text: await res.text(), cost: Date.now() - started }
  } catch (err) {
    return { status: 0, text: '', cost: Date.now() - started, error: err.message }
  }
}

function report(label, r, parse) {
  if (r.status === 0) {
    console.log(`  ${label.padEnd(10)} ✗ ${r.error}`)
    return
  }
  try {
    const info = parse(r.text)
    const ok = info.count > 0
    console.log(`  ${label.padEnd(10)} ${ok ? '✓' : '✗'} HTTP ${r.status} · ${r.cost}ms · ${info.count} 张专辑`)
    if (ok) {
      console.log(`       首条: ${info.sample}`)
      if (info.pic) console.log(`       封面: ${String(info.pic).slice(0, 100)}`)
    } else {
      console.log(`       响应片段: ${r.text.replace(/\s+/g, ' ').slice(0, 120)}`)
    }
  } catch (err) {
    console.log(`  ${label.padEnd(10)} ✗ 解析失败: ${err.message}`)
    console.log(`       片段: ${r.text.replace(/\s+/g, ' ').slice(0, 120)}`)
  }
}

console.log(`\n专辑搜索接口探测 · 关键词「${KEYWORD}」\n${'='.repeat(78)}`)

/* ---------------- QQ 音乐（t=2 搜专辑） ---------------- */
{
  const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?t=2&w=${encodeURIComponent(KEYWORD)}&format=json&n=10&p=1`
  const r = await get(url, { Referer: 'https://y.qq.com/' })
  report('QQ音乐', r, (t) => {
    const b = JSON.parse(t)
    const list = b?.data?.album?.list ?? []
    const a = list[0] ?? {}
    return {
      count: list.length,
      sample: a.albumName
        ? `${a.albumName} — ${a.singerName}（${a.song_count ?? a.songCount ?? '?'} 首）`
        : '',
      pic: a.albumMid
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${a.albumMid}.jpg`
        : ''
    }
  })
}

/* ---------------- 网易云（type=10 搜专辑，用 POST 绕开限流） ---------------- */
{
  const r = await post(
    'https://music.163.com/api/search/get',
    { s: KEYWORD, type: '10', offset: '0', limit: '10' },
    { Referer: 'https://music.163.com/', Cookie: 'appver=2.0.2; os=pc' }
  )
  report('网易云', r, (t) => {
    const b = JSON.parse(t)
    const list = b?.result?.albums ?? []
    const a = list[0] ?? {}
    return {
      count: list.length,
      sample: a.name ? `${a.name} — ${a.artist?.name ?? '?'}（${a.size ?? '?'} 首）` : '',
      pic: a.picUrl ?? ''
    }
  })
}

/* ---------------- 酷狗（独立端点 search/album） ---------------- */
{
  const url = `http://mobilecdn.kugou.com/api/v3/search/album?format=json&keyword=${encodeURIComponent(KEYWORD)}&page=1&pagesize=10`
  const r = await get(url)
  report('酷狗', r, (t) => {
    const b = JSON.parse(t)
    // 注意：酷狗的 data 有时直接是数组，有时包在 info 里
    const raw = b?.data
    const list = Array.isArray(raw) ? raw : (raw?.info ?? [])
    const a = list[0] ?? {}
    return {
      count: list.length,
      sample: a.albumname
        ? `${a.albumname} — ${a.singername}（${a.songcount ?? '?'} 首）`
        : '',
      pic: a.imgurl ?? ''
    }
  })
}

/* ---------------- 酷我（ft=album） ---------------- */
{
  const url = `http://search.kuwo.cn/r.s?all=${encodeURIComponent(KEYWORD)}&ft=album&itemset=web_2013&client=kt&pn=0&rn=10&rformat=json&encoding=utf8`
  const r = await get(url, { Referer: 'http://www.kuwo.cn/', Cookie: 'kw_token=ABCDEFGHIJKLMNOP' })
  report('酷我', r, (t) => {
    const b = parseLooseJson(t)
    const list = b?.abslist ?? []
    const a = list[0] ?? {}
    return {
      count: list.length,
      sample: a.ALBUM ? `${a.ALBUM} — ${a.ARTIST}（${a.SONGCNT ?? '?'} 首）` : '',
      pic: a.web_albumpic_short ? `https://img2.kuwo.cn/star/albumcover/${a.web_albumpic_short}` : ''
    }
  })
}

/* ---------------- 咪咕（searchSwitch 指定 album） ---------------- */
{
  const sw = encodeURIComponent(JSON.stringify({ album: 1 }))
  const url = `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?text=${encodeURIComponent(KEYWORD)}&pageNo=1&pageSize=10&isCopyright=1&searchSwitch=${sw}`
  const r = await get(url, { Referer: 'https://app.c.nf.migu.cn/' })
  report('咪咕', r, (t) => {
    const b = JSON.parse(t)
    const data = b?.albumResultData ?? {}
    const list = Array.isArray(data.result) ? data.result : []
    const a = Array.isArray(list[0]) ? list[0][0] : (list[0] ?? {})
    return {
      count: list.length,
      sample: a.name ? `${a.name} — ${a.singer ?? a.singerName ?? '?'}` : '',
      pic: a.imgItems?.[0]?.img ?? a.picUrl ?? ''
    }
  })
}

console.log('='.repeat(78) + '\n')
