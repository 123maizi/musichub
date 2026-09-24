/**
 * 酷我封面覆盖率到底跟什么有关。
 * 上一个探测发现「周杰伦」这个关键词下 20 条全是 ALBUMID=0，
 * 怀疑是那批结果本身就是拼盘/改版，酷我没有它们的专辑信息。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'

async function kuwoSearch(kw, rn = 20, client = 'kt') {
  const url =
    `http://search.kuwo.cn/r.s?all=${encodeURIComponent(kw)}` +
    `&ft=music&itemset=web_2013&client=${client}&pn=0&rn=${rn}&rformat=json&encoding=utf8`
  const res = await fetch(url, {
    headers: { Referer: 'http://www.kuwo.cn/', 'User-Agent': UA, Cookie: 'kw_token=ABCDEFGHIJKLMNOP' }
  })
  const text = await res.text()
  const items = []
  // 用正则抠出每个条目的关键字段（比宽松解析更省事，这里只是探测）
  for (const m of text.matchAll(/ALBUMID':'([^']*)'/g)) items.push({ albumId: m[1] })
  const picMatches = [...text.matchAll(/web_albumpic_short':'([^']*)'/g)].map((m) => m[1])
  const nameMatches = [...text.matchAll(/SONGNAME':'([^']*)'/g)].map((m) => m[1])
  picMatches.forEach((pic, i) => {
    if (items[i]) {
      items[i].pic = pic
      items[i].name = nameMatches[i]
    }
  })
  return items
}

console.log('\n酷我封面覆盖率：按关键词')
console.log('='.repeat(72))

const keywords = ['周杰伦', '晴天', 'The Sound of Silence', '邓紫棋', 'Alan Walker', 'Imagine', '五月天']
for (const kw of keywords) {
  const items = await kuwoSearch(kw)
  const withPic = items.filter((x) => x.pic).length
  const albumZero = items.filter((x) => !x.albumId || x.albumId === '0').length
  console.log(
    `  ${kw.padEnd(24)} 共 ${String(items.length).padStart(2)} 条   有封面 ${String(withPic).padStart(2)}   ALBUMID=0 的 ${String(albumZero).padStart(2)}`
  )
}

console.log('\n换不同的 client 参数试试（字段可能不同）')
console.log('='.repeat(72))
for (const client of ['kt', 'pc', 'web', 'android']) {
  const items = await kuwoSearch('周杰伦', 20, client)
  const withPic = items.filter((x) => x.pic).length
  console.log(`  client=${client.padEnd(10)} 共 ${items.length} 条，有封面 ${withPic}`)
}

console.log('\n前 6 条明细（client=kt）')
console.log('='.repeat(72))
const sample = await kuwoSearch('晴天')
for (const s of sample.slice(0, 6)) {
  console.log(`  ${String(s.name ?? '').slice(0, 18).padEnd(20)} albumId=${String(s.albumId).padEnd(12)} pic="${s.pic ?? ''}"`)
}
