/** 酷狗歌词完整链路验证：搜索(带 duration=0&hash=0) → 取 lrc → 看是不是真歌词 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const songs = [
  ['晴天', '周杰伦', '故事的小黄花'],
  ['稻香', '周杰伦', '对这个世界如果你有太多的抱怨'],
  ['告白气球', '周杰伦', '塞纳河畔 左岸的咖啡'],
  ['夜曲', '周杰伦', '一群嗜血的蚂蚁'],
  ['Hey Jude', 'The Beatles', 'Hey Jude']
]

for (const [name, singer, expect] of songs) {
  const kw = `${name} ${singer}`
  try {
    const sres = await fetch(
      `https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=${encodeURIComponent(kw)}&duration=0&hash=0`,
      { headers: { 'User-Agent': UA, Referer: 'https://www.kugou.com/' }, signal: AbortSignal.timeout(10000) }
    )
    const sbody = JSON.parse(await sres.text())
    const cands = sbody?.candidates ?? []

    const nameOf = (c) => String(c.song ?? '').trim()
    const singerOf = (c) => String(c.singer ?? '')
    const pick =
      cands.find((c) => nameOf(c) === name && singerOf(c).includes(singer)) ??
      cands.find((c) => nameOf(c).includes(name) && singerOf(c).includes(singer))

    if (!pick) {
      console.log(`✗ ${name} — 无「歌名+歌手」都匹配的候选`)
      console.log(`   候选: ${cands.slice(0, 5).map((c) => `${nameOf(c)} - ${singerOf(c)}`).join(' | ')}`)
      console.log('')
      continue
    }

    const lres = await fetch(
      `https://lyrics.kugou.com/download?ver=1&client=pc&id=${pick.id}&accesskey=${pick.accesskey}&fmt=lrc&charset=utf8`,
      { headers: { 'User-Agent': UA, Referer: 'https://www.kugou.com/' }, signal: AbortSignal.timeout(10000) }
    )
    const lbody = JSON.parse(await lres.text())
    const text = lbody?.content ? Buffer.from(lbody.content, 'base64').toString('utf8') : ''
    const firstLine = text.split('\n').find((l) => l.trim()) ?? ''
    const hitExpected = text.includes(expect.slice(0, 6))
    console.log(`${text.length > 20 ? '✓' : '✗'} ${name} / ${singer}`)
    console.log(`   选中: ${nameOf(pick)} - ${singerOf(pick)}  (${pick.product_from ?? ''})`)
    console.log(`   歌词 ${text.length} 字  首行: ${firstLine.slice(0, 60)}`)
    console.log(`   是否含真正歌词「${expect}」: ${hitExpected ? '✓ 是' : '✗ 不是'}`)
  } catch (e) {
    console.log(`✗ ${name}  异常: ${String(e.message).slice(0, 100)}`)
  }
  console.log('')
}
