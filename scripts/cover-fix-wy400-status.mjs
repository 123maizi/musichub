/** 用 Node 直接打这 3 个网易云封面地址，拿到确切状态码与响应体（确认是 CDN 侧对象已失效） */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const URLS = [
  'https://p3.music.126.net/-XS4M6guL1L7IbdMkdFcFw==/109951170501372100.jpg?param=300y300',
  'https://p3.music.126.net/qgesMgF8uV0kNzYoBbSE2g==/109951170702056880.jpg?param=300y300',
  'https://p3.music.126.net/CDQ-vJpS-g3oelCzq5I_iw==/109951168144493660.jpg?param=300y300',
  // 对照组：同一形态、应用里加载成功的一张
  'https://p3.music.126.net/neKfyKpJHCils8eDsgu2sg==/109951165671182690.jpg?param=300y300'
]

for (const url of URLS) {
  for (const [label, headers] of [
    ['无Referer', { 'User-Agent': UA }],
    ['带网易Referer', { 'User-Agent': UA, Referer: 'https://music.163.com/' }]
  ]) {
    try {
      const r = await fetch(url, { headers })
      const buf = Buffer.from(await r.arrayBuffer())
      const head = buf.toString('utf8', 0, 60).replace(/\s+/g, ' ')
      console.log(`${r.status} ${String(buf.length).padStart(6)}B  ${label.padEnd(14)} ${url.slice(-44)}  ${head.slice(0, 40)}`)
    } catch (e) {
      console.log(`ERR ${label} ${url.slice(-44)} ${e.message.slice(0, 40)}`)
    }
  }
}
