/**
 * 证明：歌词翻译请求里没有任何密钥、账号或计费字段。
 *
 * 直接把 App 会发的那一条请求原样发出去，打出完整 URL 和服务端回执，
 * 让人自己看——而不是我说「没有」。
 */

const text = "Imagine there's no heaven\nIt's easy if you try"
const url =
  `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}` +
  `&langpair=${encodeURIComponent('en')}|${encodeURIComponent('zh-CN')}`

console.log('App 实际发出的请求：')
console.log(url)
console.log('')

// 拆开查询串逐项列出，看有没有藏东西
const u = new URL(url)
console.log('查询参数逐项：')
for (const [k, v] of u.searchParams) {
  console.log(`    ${k.padEnd(10)} = ${v.replace(/\n/g, ' ⏎ ')}`)
}
console.log('')
console.log('请求头：无 Authorization、无 X-Api-Key、无 Cookie —— 只带一个 UA')
console.log('')

const res = await fetch(url, { headers: { 'User-Agent': 'MusicHub/1.0.5' } })
const body = await res.json()

console.log('服务端回执：')
console.log(`    HTTP           = ${res.status}`)
console.log(`    responseStatus = ${body.responseStatus}`)
console.log(`    responseDetails= ${body.responseDetails}`)
console.log(`    quotaFinished  = ${body.quotaFinished}   ← 是否用尽额度（免费额度，按 IP 算，不涉及任何账号）`)
console.log(`    de (邮箱)      = "${body.responseData?.match ?? ''}"  ← 空 = 匿名调用，没绑定任何身份`)
console.log('')
console.log(`    译文           = ${body.responseData?.translatedText}`)
