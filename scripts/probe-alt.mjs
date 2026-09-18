/**
 * 备选接口探针：为挂掉的平台找可用通道
 * 运行： node scripts/probe-alt.mjs [关键词]
 */
const KEYWORD = process.argv[2] ?? '周杰伦'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/** 把酷我那种单引号 JS 字面量转成合法 JSON */
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
      if (next === "'") {
        out += "'"
        i += 2
        continue
      }
      if (next === '"') {
        out += '\\"'
        i += 2
        continue
      }
      out += ch + (next ?? '')
      i += 2
      continue
    }
    if (ch === quote) {
      inStr = false
      out += '"'
      i++
      continue
    }
    if (quote === "'" && ch === '"') {
      out += '\\"'
      i++
      continue
    }
    out += ch
    i++
  }
  out = out.replace(/,\s*([}\]])/g, '$1')
  return JSON.parse(out)
}

async function get(url, headers = {}) {
  const started = Date.now()
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, ...headers },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow'
    })
    const text = await res.text()
    return { status: res.status, text, cost: Date.now() - started, setCookie: res.headers.getSetCookie?.() ?? [] }
  } catch (err) {
    return { status: 0, text: '', cost: Date.now() - started, error: err.message, setCookie: [] }
  }
}

function report(label, r, countFn, firstFn) {
  if (r.status === 0) {
    console.log(`${label.padEnd(26)} FAIL ${r.error}`)
    return
  }
  let info = { count: '?', first: '' }
  try {
    info = countFn(r.text)
  } catch (e) {
    info = { count: 'parse-err:' + e.message.slice(0, 40), first: '' }
  }
  console.log(
    `${label.padEnd(26)} http=${r.status} ${String(r.cost).padStart(5)}ms  命中=${info.count}  ${info.first ?? ''}`
  )
  if (info.count === 0 || typeof info.count === 'string') {
    console.log(`   → ${r.text.replace(/\s+/g, ' ').slice(0, 130)}`)
  }
}

console.log(`\n关键词: ${KEYWORD}\n${'='.repeat(78)}`)

/* ---------------- 酷我 ---------------- */
console.log('\n[酷我 kw]')

// 方案 A：r.s + 宽松解析
{
  const url = `http://search.kuwo.cn/r.s?all=${encodeURIComponent(KEYWORD)}&ft=music&itemset=web_2013&client=kt&pn=0&rn=30&rformat=json&encoding=utf8`
  const r = await get(url, { Referer: 'http://www.kuwo.cn/', Cookie: 'kw_token=ABCDEFGHIJKLMNOP' })
  report('A) r.s + 宽松解析', r, (t) => {
    const b = parseLooseJson(t)
    return { count: (b.abslist ?? []).length, first: b.abslist?.[0]?.SONGNAME }
  })
}

// 方案 B：www 接口 + csrf（先访问首页拿 kw_token）
{
  const landing = await get('http://www.kuwo.cn/', { Referer: 'http://www.kuwo.cn/' })
  const token =
    landing.setCookie.map((c) => /kw_token=([^;]+)/.exec(c)?.[1]).find(Boolean) ?? 'ABCDEFGHIJKLMNOP'
  const url = `http://www.kuwo.cn/api/www/search/searchMusicBykeyWord?key=${encodeURIComponent(
    KEYWORD
  )}&pn=1&rn=30&httpsStatus=1`
  const r = await get(url, {
    Referer: 'http://www.kuwo.cn/search/list?key=' + encodeURIComponent(KEYWORD),
    csrf: token,
    Cookie: `kw_token=${token}`
  })
  report('B) www + csrf', r, (t) => {
    const b = JSON.parse(t)
    return { count: b?.data?.list?.length ?? 0, first: b?.data?.list?.[0]?.name }
  })
}

/* ---------------- 咪咕 ---------------- */
console.log('\n[咪咕 mg]')

// 方案 A：v3 API
{
  const url = `https://music.migu.cn/v3/api/search/song?keyword=${encodeURIComponent(
    KEYWORD
  )}&pageNo=1&pageSize=30`
  const r = await get(url, { Referer: 'https://music.migu.cn/' })
  report('A) music.migu.cn v3', r, (t) => {
    const b = JSON.parse(t)
    const list = b?.data?.songList ?? b?.songList ?? []
    return { count: list.length, first: list[0]?.name ?? list[0]?.songName }
  })
}

// 方案 B：App 接口 search_all.do
{
  const sw = encodeURIComponent(JSON.stringify({ song: 1 }))
  const url = `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?text=${encodeURIComponent(
    KEYWORD
  )}&pageNo=1&pageSize=30&isCopyright=1&sort=0&searchSwitch=${sw}`
  const r = await get(url, { Referer: 'https://app.c.nf.migu.cn/' })
  report('B) app.c.nf search_all', r, (t) => {
    const b = JSON.parse(t)
    const list = b?.songResultData?.resultList ?? b?.songResultData?.result ?? []
    return { count: list.length, first: list[0]?.name ?? list[0]?.songName }
  })
}

// 方案 C：m.music 老接口带完整浏览器头
{
  const url = `https://m.music.migu.cn/migu/remoting/scr_search_tag?keyword=${encodeURIComponent(
    KEYWORD
  )}&type=2&rows=30&pgc=1`
  const r = await get(url, {
    Referer: `https://m.music.migu.cn/migu/migu/views/search/searchResult.html?keyword=${encodeURIComponent(KEYWORD)}`,
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest'
  })
  report('C) m.music 带XHR头', r, (t) => {
    const b = JSON.parse(t)
    return { count: (b.musics ?? []).length, first: b.musics?.[0]?.songName }
  })
}

console.log('\n' + '='.repeat(78))
