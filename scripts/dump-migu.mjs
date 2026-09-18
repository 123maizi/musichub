/** 查明咪咕返回里的时长字段究竟叫什么 */
const keyword = encodeURIComponent('周杰伦')
const sw = encodeURIComponent(JSON.stringify({ song: 1 }))
const url =
  `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?text=${keyword}` +
  `&pageNo=1&pageSize=1&isCopyright=1&sort=0&searchSwitch=${sw}`

const res = await fetch(url, {
  headers: { Referer: 'https://app.c.nf.migu.cn/', 'User-Agent': 'Mozilla/5.0' }
})
const json = await res.json()
const list = json.songResultData.resultList
console.log('resultList 类型:', Array.isArray(list) ? 'array' : typeof list)
console.log('resultList[0] 类型:', Array.isArray(list[0]) ? 'array(嵌套)' : typeof list[0])

const song = Array.isArray(list[0]) ? list[0][0] : list[0]
console.log('\n全部字段:', Object.keys(song).join(', '))

console.log('\n--- 时长相关字段 ---')
for (const k of Object.keys(song)) {
  if (/dur|time|len|size|sec/i.test(k)) console.log(`  ${k} = ${JSON.stringify(song[k])}`)
}

console.log('\n--- 标量字段全貌 ---')
const scalars = Object.fromEntries(
  Object.entries(song).filter(([, v]) => v === null || typeof v !== 'object')
)
console.log(JSON.stringify(scalars, null, 1))
