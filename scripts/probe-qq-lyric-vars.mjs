/** 找出 search_for_qq_cp 为什么在歌词链路里搜不到 —— 逐个变量对照 */
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const variants = [
  { name: '搜索层原样：n=30 无空格关键词', w: '周杰伦', n: 30, extra: '' },
  { name: '歌词链路：n=3 无空格关键词', w: '周杰伦', n: 3, extra: '' },
  { name: '歌词链路：n=3 带空格关键词', w: '晴天 周杰伦', n: 3, extra: '' },
  { name: 'n=3 带空格 且加 cr=1', w: '晴天 周杰伦', n: 3, extra: '&cr=1' },
  { name: 'n=3 无空格 且加 cr=1', w: '晴天', n: 3, extra: '&cr=1' },
  { name: 'n=30 带空格', w: '晴天 周杰伦', n: 30, extra: '' }
]

for (const v of variants) {
  const url =
    `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=1&n=${v.n}` +
    `&w=${encodeURIComponent(v.w)}&format=json${v.extra}`
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      headers: { Referer: 'https://y.qq.com/', 'User-Agent': DEFAULT_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    })
    const text = await res.text()
    let count = -1
    let firstTitle = null
    try {
      const j = JSON.parse(text)
      const list = j?.data?.song?.list ?? []
      count = list.length
      firstTitle = list[0] ? String(list[0].title || list[0].songname) : null
    } catch {
      /* ignore */
    }
    const echoed = (/"keyword":"([^"]*)"/.exec(text) ?? [])[1] ?? '?'
    console.log(`${count > 0 ? '✓' : '✗'} ${v.name}`)
    console.log(`     HTTP ${res.status}  ${Date.now() - t0}ms  命中=${count}  回显keyword="${echoed}"  首条=${firstTitle ?? '-'}`)
    console.log(`     URL: ${url.slice(0, 120)}`)
  } catch (err) {
    console.log(`✗ ${v.name}  请求失败: ${err?.message ?? err}`)
  }
  console.log('')
}
