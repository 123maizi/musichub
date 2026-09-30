/** 连续压酷我搜索接口，看它在第几次开始返回 HTML（限流实测） */
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const HEADERS = {
  Referer: 'http://www.kuwo.cn/',
  'User-Agent': DEFAULT_UA,
  Cookie: 'kw_token=ABCDEFGHIJKLMNOP'
}

const KEYWORDS = ['周杰伦', '林俊杰', '陈奕迅', '邓紫棋', '薛之谦', '五月天', '李荣浩', '毛不易']

console.log('连续请求酷我搜索接口，观察返回形态：\n')
let firstHtml = -1
for (let i = 0; i < 16; i += 1) {
  const kw = KEYWORDS[i % KEYWORDS.length]
  const url =
    `http://search.kuwo.cn/r.s?all=${encodeURIComponent(kw)}` +
    `&ft=music&itemset=web_2013&client=kt&pn=0&rn=20&rformat=json&encoding=utf8`
  const t0 = Date.now()
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000) })
    const text = await res.text()
    const isHtml = /^\s*<(!doctype|html|head)/i.test(text)
    if (isHtml && firstHtml < 0) firstHtml = i + 1
    console.log(
      `#${String(i + 1).padStart(2)}  ${String(res.status).padEnd(4)} ${String(text.length).padStart(7)} 字节  ${String(Date.now() - t0).padStart(5)}ms  ${isHtml ? 'HTML ← 被挡了' : '数据'}`
    )
    if (isHtml) console.log(`     开头: ${text.slice(0, 150).replace(/\s+/g, ' ')}`)
  } catch (err) {
    console.log(`#${String(i + 1).padStart(2)}  请求失败: ${err?.message ?? err}`)
    if (firstHtml < 0) firstHtml = i + 1
  }
}
console.log('')
console.log(firstHtml > 0 ? `第 ${firstHtml} 次开始异常` : '16 次全部正常，不是限流问题')
