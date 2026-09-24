/** 找可用的 QQ 搜索接口（老接口已返回 500） */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
const KW = '周杰伦'

const candidates = [
  {
    label: 'smartbox 联想',
    url: `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=${encodeURIComponent(KW)}&format=json`,
    headers: { Referer: 'https://y.qq.com/', 'User-Agent': UA },
    pick: (j) => j?.data?.song?.itemlist ?? []
  },
  {
    label: 'search_for_qq_cp',
    url: `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?w=${encodeURIComponent(KW)}&format=json&n=5&p=1&cr=1&new_json=1`,
    headers: { Referer: 'https://y.qq.com/', 'User-Agent': UA },
    pick: (j) => j?.data?.song?.list ?? []
  },
  {
    label: 'musicu.fcg DoSearch',
    url:
      'https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=' +
      encodeURIComponent(
        JSON.stringify({
          req_1: {
            module: 'music.search.SearchCgiService',
            method: 'DoSearchForQQMusicDesktop',
            param: { query: KW, num_per_page: 5, page_num: 1, search_type: 0 }
          }
        })
      ),
    headers: { Referer: 'https://y.qq.com/', 'User-Agent': UA },
    pick: (j) => j?.req_1?.data?.body?.song?.list ?? []
  },
  {
    label: 'musicu.fcg 带 comm',
    url:
      'https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=' +
      encodeURIComponent(
        JSON.stringify({
          comm: { ct: 24, cv: 0, v: '0.0.1' },
          req_1: {
            module: 'music.search.SearchCgiService',
            method: 'DoSearchForQQMusicDesktop',
            param: { query: KW, num_per_page: 5, page_num: 1, search_type: 0, grp: 1 }
          }
        })
      ),
    headers: { Referer: 'https://y.qq.com/portal/player.html', 'User-Agent': UA },
    pick: (j) => j?.req_1?.data?.body?.song?.list ?? []
  }
]

console.log('\nQQ 搜索接口候选实测')
console.log('='.repeat(78))
for (const c of candidates) {
  try {
    const r = await fetch(c.url, { headers: c.headers })
    const text = await r.text()
    let note = ''
    if (r.status === 200) {
      try {
        const j = JSON.parse(text)
        const list = c.pick(j)
        if (Array.isArray(list) && list.length > 0) {
          const first = list[0]
          const mid = first?.album?.mid ?? first?.mid ?? first?.albumMid ?? '?'
          note = `歌曲 ${list.length} 首；首条: ${first?.title ?? first?.name ?? first?.songname} / albumMid=${mid}`
        } else {
          note = `解析出 0 首，响应头 200 字符: ${text.slice(0, 100)}`
        }
      } catch {
        note = `非 JSON: ${text.slice(0, 100)}`
      }
    } else {
      note = text.slice(0, 80) || '(空响应)'
    }
    console.log(`  ${c.label.padEnd(20)} HTTP ${r.status}  ${note}`)
  } catch (e) {
    console.log(`  ${c.label.padEnd(20)} 失败: ${e.message.slice(0, 70)}`)
  }
}
console.log('='.repeat(78))
