/** 验证歌词链路里 QQ 搜索接口是否已死，以及替代接口是否可用 */
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const QQ_HEADERS = {
  Referer: 'https://y.qq.com/portal/player.html',
  'User-Agent': DEFAULT_UA,
  Cookie: 'pgv_pvid=1; ts_uid=1'
}

const kw = '晴天 周杰伦'

const cases = [
  {
    name: '歌词链路现用：client_search_cp + new_json=1（怀疑已死）',
    url: `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=3&w=${encodeURIComponent(kw)}&format=json&cr=1&new_json=1`
  },
  {
    name: '替代：search_for_qq_cp（不带 new_json）',
    url: `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=1&n=3&w=${encodeURIComponent(kw)}&format=json&cr=1`
  },
  {
    name: '替代：search_for_qq_cp（带 new_json=1，字段会变空）',
    url: `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=1&n=3&w=${encodeURIComponent(kw)}&format=json&cr=1&new_json=1`
  }
]

for (const c of cases) {
  const t0 = Date.now()
  try {
    const res = await fetch(c.url, { headers: QQ_HEADERS, signal: AbortSignal.timeout(10000) })
    const text = await res.text()
    let picked = null
    try {
      const j = JSON.parse(text.replace(/^[^(]*\(/, '').replace(/\)\s*;?$/, ''))
      const list = j?.data?.song?.list ?? []
      picked = list[0]
        ? {
            歌名: picked.title ?? picked.songname,
            歌手: picked.singer?.[0]?.name ?? picked.singer?.[0]?.name_hilight,
            mid: picked.mid ?? picked.songmid,
            有albumname: Boolean(picked.albumname)
          }
        : '列表为空'
    } catch (e) {
      picked = '解析失败: ' + String(e.message).slice(0, 60)
    }
    console.log(`── ${c.name}`)
    console.log(`   HTTP ${res.status}  ${text.length} 字节  ${Date.now() - t0}ms`)
    console.log(`   首条: ${JSON.stringify(picked)}`)
    if (res.status !== 200) console.log(`   原文开头: ${text.slice(0, 120).replace(/\s+/g, ' ')}`)
    console.log('')
  } catch (err) {
    console.log(`── ${c.name}`)
    console.log(`   请求失败 (${Date.now() - t0}ms): ${err?.message ?? err}`)
    console.log('')
  }
}
