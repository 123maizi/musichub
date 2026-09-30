/** 验证酷狗歌词接口能不能作为第三源（酷狗有周杰伦正版，网易没有） */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

async function kugouLyric(name, singer) {
  const kw = `${name} ${singer}`
  const sres = await fetch(
    `https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=${encodeURIComponent(kw)}&duration=&hash=`,
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) }
  )
  const sbody = JSON.parse(await sres.text())
  const cands = sbody?.candidates ?? []
  if (!cands.length) return { ok: false, why: '搜索无候选', raw: JSON.stringify(sbody).slice(0, 120) }

  // 优先歌名+歌手都对得上的
  const pick =
    cands.find((c) => c.song === name && (c.singer ?? '').includes(singer)) ??
    cands.find((c) => (c.song ?? '').includes(name) && (c.singer ?? '').includes(singer)) ??
    null
  if (!pick) {
    return {
      ok: false,
      why: '没有歌名+歌手都匹配的候选',
      候选: cands.slice(0, 4).map((c) => `${c.song} - ${c.singer}`)
    }
  }
  const lres = await fetch(
    `https://lyrics.kugou.com/download?ver=1&client=pc&id=${pick.id}&accesskey=${pick.accesskey}&fmt=lrc&charset=utf8`,
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) }
  )
  const lbody = JSON.parse(await lres.text())
  const b64 = lbody?.content ?? ''
  const text = b64 ? Buffer.from(b64, 'base64').toString('utf8') : ''
  return { ok: text.length > 20, 选中: `${pick.song} - ${pick.singer}`, 字数: text.length, 首行: text.split('\n').find((l) => l.trim())?.slice(0, 50) }
}

for (const [n, s] of [
  ['晴天', '周杰伦'],
  ['稻香', '周杰伦'],
  ['告白气球', '周杰伦'],
  ['夜曲', '周杰伦'],
  ['Hey Jude', 'The Beatles']
]) {
  try {
    const r = await kugouLyric(n, s)
    console.log(`${r.ok ? '✓' : '✗'} ${n} / ${s}`)
    console.log(`   ${JSON.stringify(r)}`)
  } catch (e) {
    console.log(`✗ ${n} / ${s}  异常: ${String(e.message).slice(0, 100)}`)
  }
  console.log('')
}
