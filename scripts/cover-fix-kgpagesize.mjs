/**
 * 主进程用的参数是 pagesize=3 / n=3，而前面的候选枚举用了 5。
 * 这里把两种参数的原样响应打出来，确认「候选有没有封面字段」是否随参数变化 ——
 * 这是解释「Node 侧能搜到、应用侧却返回 null」的关键。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const KEYWORDS = ['稻香 (完整版|DJ Ray版) 周杰伦', '夜曲 (升调版伴奏) 周杰伦', '烟花易冷 (片段) 周杰伦']

function coverOf(item) {
  const raw = item?.trans_param
  if (!raw) return '(无 trans_param)'
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw
    return p?.union_cover ? p.union_cover.slice(0, 70) : '(无 union_cover)'
  } catch {
    return '(trans_param 解析失败)'
  }
}

for (const kw of KEYWORDS) {
  console.log(`\n===== ${kw} =====`)
  for (const size of [3, 5]) {
    const url = `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(kw)}&page=1&pagesize=${size}&showtype=1`
    const r = await fetch(url, { headers: { 'User-Agent': UA } })
    const j = await r.json()
    const list = j?.data?.info ?? []
    console.log(`  pagesize=${size} -> ${list.length} 条`)
    list.forEach((it, i) => {
      console.log(`    [${i}] ${it.songname} - ${it.singername} | ${coverOf(it)}`)
    })
  }
}
