/**
 * 深挖两件事：
 *   1. 酷狗按「歌名+歌手」搜时 trans_param 为什么解析失败（原文是什么样）
 *   2. QQ 搜索接口返回 500 —— 是参数变了还是接口挂了
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'

console.log('\n[1] 酷狗 trans_param 原文')
console.log('='.repeat(78))
for (const kw of ['周杰伦', '蜗牛 周杰伦']) {
  const url =
    `http://mobilecdn.kugou.com/api/v3/search/song?format=json` +
    `&keyword=${encodeURIComponent(kw)}&page=1&pagesize=2&showtype=1`
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  const j = await r.json()
  const list = j?.data?.info ?? []
  console.log(`\n关键词「${kw}」→ ${list.length} 条`)
  for (const item of list.slice(0, 2)) {
    console.log(`  ${item.songname} - ${item.singername}`)
    console.log(`    trans_param 类型: ${typeof item.trans_param}`)
    const raw = item.trans_param
    if (typeof raw === 'string') {
      console.log(`    原文(${raw.length} 字符): ${raw.slice(0, 180)}`)
      try {
        JSON.parse(raw)
        console.log('    JSON.parse: 成功')
      } catch (e) {
        console.log(`    JSON.parse 失败: ${e.message.slice(0, 60)}`)
      }
    } else {
      console.log(`    值: ${JSON.stringify(raw)?.slice(0, 180)}`)
    }
  }
}

console.log('\n\n[2] QQ 搜索接口各种参数组合')
console.log('='.repeat(78))
const qqVariants = [
  ['原始（带 Referer）', 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=3&w=%E5%91%A8%E6%9D%B0%E4%BC%A6&format=json&cr=1&new_json=1', { Referer: 'https://y.qq.com/', 'User-Agent': UA }],
  ['只带 UA', 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=3&w=%E5%91%A8%E6%9D%B0%E4%BC%A6&format=json&cr=1&new_json=1', { 'User-Agent': UA }],
  ['去掉 new_json', 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=3&w=%E5%91%A8%E6%9D%B0%E4%BC%A6&format=json&cr=1', { Referer: 'https://y.qq.com/', 'User-Agent': UA }],
  ['http 而非 https', 'http://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=3&w=%E5%91%A8%E6%9D%B0%E4%BC%A6&format=json&cr=1&new_json=1', { Referer: 'https://y.qq.com/', 'User-Agent': UA }],
  ['u.y.qq.com 移动端', 'https://u.y.qq.com/cgi-bin/musicu.fcg?data=%7B%22req%22%3A%7B%22method%22%3A%22DoSearchForQQMusicDesktop%22%2C%22module%22%3A%22music.search.SearchCgiService%22%2C%22param%22%3A%7B%22query%22%3A%22%E5%91%A8%E6%9D%B0%E4%BC%A6%22%2C%22num_per_page%22%3A%223%22%2C%22page_num%22%3A%221%22%7D%7D%7D', { Referer: 'https://y.qq.com/', 'User-Agent': UA }]
]
for (const [label, url, headers] of qqVariants) {
  try {
    const r = await fetch(url, { headers })
    const text = await r.text()
    let note = ''
    if (r.status === 200) {
      try {
        const j = JSON.parse(text)
        const songList =
          j?.data?.song?.list ?? j?.req?.data?.body?.song?.list ?? null
        note = songList ? `歌曲 ${songList.length} 首，首条专辑 mid=${songList[0]?.album?.mid ?? '?'}` : `结构未知: ${text.slice(0, 70)}`
      } catch {
        note = text.slice(0, 70)
      }
    } else {
      note = text.slice(0, 70) || '(空响应)'
    }
    console.log(`  ${label.padEnd(22)} HTTP ${r.status}  ${note}`)
  } catch (e) {
    console.log(`  ${label.padEnd(22)} 失败: ${e.message.slice(0, 60)}`)
  }
}
console.log('\n' + '='.repeat(78))
