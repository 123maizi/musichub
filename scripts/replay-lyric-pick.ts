/**
 * 完全复刻主进程里 pickBestSongItem 的判定，逐条打印每个候选为什么通过/被拒。
 * 直接调真实网易接口，拿到的就是应用看到的那份数据。
 */
import { hasVariantMark } from '../src/shared/purity'

const H = {
  Referer: 'https://music.163.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Cookie: 'appver=2.0.2; os=pc',
  Accept: 'application/json'
}

const str = (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v))

function judge(list, targetName, singer) {
  const name = targetName.trim()
  const primary = singer.split(/[/、,，]/)[0]?.trim() ?? ''
  const nameOf = (item) => str(item.name ?? item.title ?? item.songname).trim()
  const artistsOf = (item) => {
    const arr = item.artists ?? item.singer
    if (Array.isArray(arr)) return arr.map((a) => str(a?.name)).join('/')
    return str(arr)
  }
  const nameMatches = (item) => {
    const got = nameOf(item)
    return got === name || got.includes(name) || name.includes(got)
  }
  const singerMatches = (item) => {
    const got = artistsOf(item)
    if (!got.trim()) return true
    return primary ? got.includes(primary) : true
  }
  const wantVariant = hasVariantMark(targetName)
  const variantMatches = (item) => wantVariant || !hasVariantMark(nameOf(item))

  const rows = list.map((item, i) => ({
    i,
    歌名: nameOf(item),
    歌手: artistsOf(item),
    歌名匹配: nameMatches(item),
    歌手匹配: singerMatches(item),
    非变体: variantMatches(item)
  }))
  const picked = list.find((item) => nameMatches(item) && singerMatches(item) && variantMatches(item))
  return { rows, picked: picked ? nameOf(picked) : null }
}

for (const [name, singer] of [
  ['稻香', '周杰伦'],
  ['晴天', '周杰伦'],
  ['Hey Jude', 'The Beatles']
]) {
  console.log(`\n═══ ${name} / ${singer}`)
  const res = await fetch('https://music.163.com/api/search/get', {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ s: `${name} ${singer}`, type: '1', offset: '0', limit: '5' }).toString(),
    signal: AbortSignal.timeout(10000)
  })
  const body = JSON.parse(await res.text())
  const list = body?.result?.songs ?? []
  console.log(`  返回 ${list.length} 条候选：`)
  const { rows, picked } = judge(list, name, singer)
  for (const r of rows) {
    const ok = r.歌名匹配 && r.歌手匹配 && r.非变体
    console.log(
      `   ${ok ? '✓ 通过' : '✗ 拒绝'}  ${r.歌名.padEnd(26)} | ${r.歌手.slice(0, 24).padEnd(24)} | 歌名${r.歌名匹配 ? '✓' : '✗'} 歌手${r.歌手匹配 ? '✓' : '✗'} 非变体${r.非变体 ? '✓' : '✗'}`
    )
  }
  console.log(`  → 最终选中: ${picked ?? '（无，应判为没有歌词）'}`)

  if (picked) {
    const id = list[rows.find((r) => r.歌名 === picked && r.歌名匹配 && r.歌手匹配 && r.非变体)]?.i
    const target = list.find((i) => String(i.name ?? '').trim() === picked)
    if (target?.id) {
      const lres = await fetch(
        `https://music.163.com/api/song/lyric?id=${target.id}&lv=-1&kv=-1&tv=-1`,
        { headers: H, signal: AbortSignal.timeout(10000) }
      )
      const lb = JSON.parse(await lres.text())
      const lyric = String(lb?.lrc?.lyric ?? '')
      console.log(`  → 该候选 id=${target.id} 歌词 ${lyric.length} 字`)
    }
  }
}
