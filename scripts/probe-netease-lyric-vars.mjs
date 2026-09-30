/** 网易歌词接口的返回原文 + 换参数对照 */
const H = {
  Referer: 'https://music.163.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Cookie: 'appver=2.0.2; os=pc',
  Accept: 'application/json'
}

// 先用搜索拿到 晴天 的真实 id
const sres = await fetch('https://music.163.com/api/search/get', {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ s: '晴天 周杰伦', type: '1', offset: '0', limit: '5' }).toString(),
  signal: AbortSignal.timeout(10000)
})
const sbody = JSON.parse(await sres.text())
const list = sbody?.result?.songs ?? []
console.log('搜索结果：')
for (const s of list.slice(0, 5)) {
  console.log(`   id=${s.id}  ${s.name} - ${(s.artists ?? []).map((a) => a.name).join('/')}  fee=${s.fee}`)
}
const picked = list.find((i) => i.name === '晴天') ?? list[0]
console.log(`\n选中 id=${picked?.id}\n`)

const variants = [
  { name: '现用：lv=1&kv=1&tv=-1', url: `https://music.163.com/api/song/lyric?id=${picked.id}&lv=1&kv=1&tv=-1` },
  { name: '全量：lv=-1&kv=-1&tv=-1', url: `https://music.163.com/api/song/lyric?id=${picked.id}&lv=-1&kv=-1&tv=-1` },
  { name: '只取歌词：lv=-1', url: `https://music.163.com/api/song/lyric?id=${picked.id}&lv=-1&kv=-1&tv=-1&rv=-1` },
  { name: '新版路径 /api/song/lyric/v1', url: `https://music.163.com/api/song/lyric/v1?id=${picked.id}&lv=1&kv=1&tv=-1` },
  {
    name: 'weapi 前置（player.lyric）',
    url: `https://music.163.com/api/song/lyric?os=pc&id=${picked.id}&lv=-1&kv=-1&tv=-1`
  }
]

for (const v of variants) {
  try {
    const res = await fetch(v.url, { headers: H, signal: AbortSignal.timeout(10000) })
    const text = await res.text()
    let len = -1
    let extra = ''
    try {
      const j = JSON.parse(text)
      len = String(j?.lrc?.lyric ?? '').length
      extra = Object.keys(j).join(',')
    } catch {
      extra = '非 JSON'
    }
    console.log(`${len > 20 ? '✓' : '✗'} ${v.name}`)
    console.log(`     HTTP ${res.status}  歌词 ${len} 字  返回字段: ${extra}`)
    if (len <= 20) console.log(`     原文: ${text.slice(0, 200).replace(/\s+/g, ' ')}`)
  } catch (err) {
    console.log(`✗ ${v.name}  失败: ${err?.message ?? err}`)
  }
  console.log('')
}
