/**
 * 歌手搜索接口探测
 *
 * 在动手写艺人页之前，先确认五个平台的歌手搜索接口各自是否可用、
 * 返回结构长什么样 —— 免得代码写完才发现接口是死的。
 *
 * 运行： node scripts/probe-artist.mjs [歌手名]
 */
const KEYWORD = process.argv[2] ?? '蛋堡'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/** 酷我返回的是单引号 JS 字面量，需要宽松解析 */
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
    const text = await res.text()
    return { status: res.status, text, cost: Date.now() - started }
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
    console.log(
      `  ${label.padEnd(10)} ${ok ? '✓' : '✗'} HTTP ${r.status} · ${r.cost}ms · ${info.count} 位艺人`
    )
    if (ok) {
      console.log(`       首条: ${info.sample}`)
      if (info.pic) console.log(`       头像: ${String(info.pic).slice(0, 95)}`)
    } else {
      console.log(`       响应片段: ${r.text.replace(/\s+/g, ' ').slice(0, 110)}`)
    }
  } catch (err) {
    console.log(`  ${label.padEnd(10)} ✗ 解析失败: ${err.message}`)
    console.log(`       片段: ${r.text.replace(/\s+/g, ' ').slice(0, 110)}`)
  }
}

console.log(`\n歌手搜索接口探测 · 关键词「${KEYWORD}」\n${'='.repeat(76)}`)

/* ---------------- QQ 音乐（t=9 表示搜歌手） ---------------- */
{
  const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?t=9&w=${encodeURIComponent(KEYWORD)}&format=json&n=10&p=1`
  const r = await get(url, { Referer: 'https://y.qq.com/' })
  report('QQ音乐', r, (t) => {
    const b = JSON.parse(t)
    const list = b?.data?.singer?.list ?? []
    return {
      count: list.length,
      sample: list[0] ? `${list[0].singer_name}（歌曲 ${list[0].song_num} 首 / mid=${list[0].singer_mid}）` : '',
      pic: list[0]?.singer_pic
    }
  })
}

/* ---------------- 网易云（type=100 表示歌手） ---------------- */
{
  const url = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(KEYWORD)}&type=100&offset=0&limit=10&total=true`
  const r = await get(url, {
    Referer: 'https://music.163.com/',
    Cookie: 'appver=2.0.2; os=pc'
  })
  report('网易云', r, (t) => {
    const b = JSON.parse(t)
    const list = b?.result?.artists ?? []
    return {
      count: list.length,
      sample: list[0] ? `${list[0].name}（歌曲 ${list[0].musicSize} 首 / 专辑 ${list[0].albumSize}）` : '',
      pic: list[0]?.picUrl
    }
  })
}

/* ---------------- 酷狗 ---------------- */
{
  const url = `http://mobilecdn.kugou.com/api/v3/search/singer?format=json&keyword=${encodeURIComponent(KEYWORD)}&page=1&pagesize=10`
  const r = await get(url)
  report('酷狗', r, (t) => {
    const b = JSON.parse(t)
    const list = b?.data?.info ?? []
    return {
      count: list.length,
      sample: list[0] ? `${list[0].singername}（歌曲 ${list[0].songcount} 首）` : '',
      pic: list[0]?.imgurl
    }
  })
}

/* ---------------- 酷我（ft=artist） ---------------- */
{
  const url = `http://search.kuwo.cn/r.s?all=${encodeURIComponent(KEYWORD)}&ft=artist&itemset=web_2013&client=kt&pn=0&rn=10&rformat=json&encoding=utf8`
  const r = await get(url, { Referer: 'http://www.kuwo.cn/', Cookie: 'kw_token=ABCDEFGHIJKLMNOP' })
  report('酷我', r, (t) => {
    const b = parseLooseJson(t)
    const list = b?.abslist ?? []
    return {
      count: list.length,
      sample: list[0] ? `${list[0].ARTIST}（id=${list[0].ARTISTID}）` : '',
      pic: list[0]?.ARTISTPIC || list[0]?.web_artistpic
    }
  })
}

/* ---------------- 咪咕 ---------------- */
{
  const sw = encodeURIComponent(JSON.stringify({ singer: 1 }))
  const url = `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?text=${encodeURIComponent(KEYWORD)}&pageNo=1&pageSize=10&isCopyright=1&searchSwitch=${sw}`
  const r = await get(url, { Referer: 'https://app.c.nf.migu.cn/' })
  report('咪咕', r, (t) => {
    const b = JSON.parse(t)
    const data = b?.singerResultData ?? {}
    const list = Array.isArray(data.resultList) ? data.resultList : []
    const first = Array.isArray(list[0]) ? list[0][0] : list[0]
    return {
      count: list.length,
      sample: first ? `${first.name ?? first.singerName}（id=${first.id}）` : '',
      pic: first?.imgItems?.[0]?.img ?? first?.picUrl
    }
  })
}

console.log('='.repeat(76) + '\n')
