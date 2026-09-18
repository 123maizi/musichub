/**
 * 字段结构转储：把可用接口的第一条原始记录完整打印出来，
 * 用来确认映射字段，避免凭猜测写死字段名。
 */
const KEYWORD = process.argv[2] ?? '周杰伦'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

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

async function grab(url, headers) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(15000)
  })
  return res.text()
}

console.log('\n### 酷我 kw —— 第一条原始记录 ###')
{
  const text = await grab(
    `http://search.kuwo.cn/r.s?all=${encodeURIComponent(KEYWORD)}&ft=music&itemset=web_2013&client=kt&pn=0&rn=30&rformat=json&encoding=utf8`,
    { Referer: 'http://www.kuwo.cn/', Cookie: 'kw_token=ABCDEFGHIJKLMNOP' }
  )
  const first = parseLooseJson(text).abslist?.[0] ?? {}
  // 只看有值的字段，输出更紧凑
  const slim = Object.fromEntries(Object.entries(first).filter(([, v]) => v !== '' && v !== null))
  console.log(JSON.stringify(slim, null, 2).slice(0, 2000))
}

console.log('\n### 咪咕 mg —— 第一条原始记录 ###')
{
  const sw = encodeURIComponent(JSON.stringify({ song: 1 }))
  const text = await grab(
    `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?text=${encodeURIComponent(
      KEYWORD
    )}&pageNo=1&pageSize=30&isCopyright=1&sort=0&searchSwitch=${sw}`,
    { Referer: 'https://app.c.nf.migu.cn/' }
  )
  const json = JSON.parse(text)
  const data = json.songResultData ?? {}
  console.log('顶层键:', Object.keys(json).join(', '))
  console.log('songResultData 键:', Object.keys(data).join(', '))
  const first = (data.resultList ?? data.result ?? [])[0] ?? {}
  const slim = Object.fromEntries(
    Object.entries(first).filter(([, v]) => v !== '' && v !== null && !Array.isArray(v))
  )
  console.log('第一条标量字段:', JSON.stringify(slim, null, 2).slice(0, 1600))
  console.log('singers:', JSON.stringify(first.singers ?? first.singerList ?? null).slice(0, 300))
  console.log('albums:', JSON.stringify(first.albums ?? first.albumList ?? null).slice(0, 300))
}
