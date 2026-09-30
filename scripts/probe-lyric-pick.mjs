/** 用真实网易返回复算 pickBestSongItem 的选歌过程，并验证 lv=-1 取词 */
const H = {
  Referer: 'https://music.163.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Cookie: 'appver=2.0.2; os=pc',
  Accept: 'application/json'
}

async function search(kw) {
  const res = await fetch('https://music.163.com/api/search/get', {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ s: kw, type: '1', offset: '0', limit: '5' }).toString(),
    signal: AbortSignal.timeout(10000)
  })
  const b = JSON.parse(await res.text())
  return b?.result?.songs ?? []
}

for (const [name, singer] of [
  ['晴天', '周杰伦'],
  ['告白气球', '周杰伦'],
  ['稻香', '周杰伦']
]) {
  const kw = `${name} ${singer}`
  console.log(`\n═══ ${name} / ${singer}   关键词「${kw}」`)
  const list = await search(kw)
  if (!list.length) {
    console.log('  搜索无结果')
    continue
  }
  list.forEach((it, i) => {
    const artists = (it.artists ?? []).map((a) => a.name).join('/')
    console.log(`  [${i}] ${it.name}  —  ${artists}   (id=${it.id})`)
  })

  // 复算 pickBestSongItem
  const nameOf = (i) => String(i.name ?? '').trim()
  const artistsOf = (i) => (i.artists ?? []).map((a) => a.name).join('/')
  let picked =
    list.find((i) => nameOf(i) === name && artistsOf(i).includes(singer)) ??
    list.find((i) => nameOf(i) === name) ??
    list.find((i) => nameOf(i).includes(name) && artistsOf(i).includes(singer)) ??
    list[0]
  console.log(`  → 选中: ${picked.name} — ${artistsOf(picked)}  (id=${picked.id})`)

  // 用 lv=-1 取词
  const lres = await fetch(
    `https://music.163.com/api/song/lyric?id=${picked.id}&lv=-1&kv=-1&tv=-1`,
    { headers: H, signal: AbortSignal.timeout(10000) }
  )
  const lb = JSON.parse(await lres.text())
  const len = String(lb?.lrc?.lyric ?? '').length
  console.log(`  → 歌词 ${len} 字 ${len > 20 ? '✓' : '✗ 仍然拿不到'}`)
  if (len > 20) console.log(`     首行: ${String(lb.lrc.lyric).split('\n').find((l) => l.trim())?.slice(0, 50)}`)
}
