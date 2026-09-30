/** 探测酷我搜索接口现在的真实返回 */
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const candidates = [
  {
    name: '现行：search.kuwo.cn/r.s (http)',
    url: 'http://search.kuwo.cn/r.s?all=%E5%91%A8%E6%9D%B0%E4%BC%A6&ft=music&itemset=web_2013&client=kt&pn=0&rn=20&rformat=json&encoding=utf8',
    headers: { Referer: 'http://www.kuwo.cn/', 'User-Agent': DEFAULT_UA, Cookie: 'kw_token=ABCDEFGHIJKLMNOP' }
  },
  {
    name: 'HTTPS 版本',
    url: 'https://search.kuwo.cn/r.s?all=%E5%91%A8%E6%9D%B0%E4%BC%A6&ft=music&itemset=web_2013&client=kt&pn=0&rn=20&rformat=json&encoding=utf8',
    headers: { Referer: 'https://www.kuwo.cn/', 'User-Agent': DEFAULT_UA }
  },
  {
    name: 'www.kuwo.cn/api/www/search/searchMusicBykeyWord',
    url: 'https://www.kuwo.cn/api/www/search/searchMusicBykeyWord?key=%E5%91%A8%E6%9D%B0%E4%BC%A6&pn=1&rn=20&httpsStatus=1',
    headers: { Referer: 'https://www.kuwo.cn/search/list?key=%E5%91%A8%E6%9D%B0%E4%BC%A6', 'User-Agent': DEFAULT_UA, csrf: '', Cookie: 'kw_token=' }
  },
  {
    name: '移动端 mobi.kuwo.cn',
    url: 'https://mobi.kuwo.cn/mobi.s?f=kuwo&q=5L2g5aW95ZCX&q=%E5%91%A8%E6%9D%B0%E4%BC%A6',
    headers: { 'User-Agent': DEFAULT_UA }
  },
  {
    name: 'antiserver 搜索',
    url: 'http://antiserver.kuwo.cn/anti.s?type=convert_url&format=mp3&response=url&rid=MUSIC_474678847',
    headers: { 'User-Agent': DEFAULT_UA }
  }
]

for (const c of candidates) {
  try {
    const ctrl = AbortSignal.timeout(12000)
    const res = await fetch(c.url, { headers: c.headers, signal: ctrl, redirect: 'follow' })
    const text = await res.text()
    const head = text.slice(0, 120).replace(/\s+/g, ' ')
    const looksHtml = /^\s*<(!doctype|html|head)/i.test(text)
    console.log(`── ${c.name}`)
    console.log(`   HTTP ${res.status}  ${res.headers.get('content-type') ?? ''}  ${text.length} 字节`)
    console.log(`   ${looksHtml ? '⚠ 返回 HTML（不是数据）' : '返回数据'}`)
    console.log(`   开头: ${head}`)
    console.log('')
  } catch (err) {
    console.log(`── ${c.name}`)
    console.log(`   请求失败: ${err?.message ?? err}`)
    console.log('')
  }
}
