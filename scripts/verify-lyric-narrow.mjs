/**
 * 收窄验收：歌词面板里还剩多少「没中文」的行。
 *
 * 用户看到的「一半有中文一半没有」，主因是 credits（作词/作曲/制作人…）
 * 和纯符号行混在歌词流里。这一版把它们分出去之后，这里量三件事：
 *   1. 歌词流里还有多少行没有译文（应当只剩余极少数真歌词 + 拟声行）
 *   2. 歌词流里是否还残留 credits（不该有）
 *   3. 是否出现了「歌曲信息」区块（信息没丢）
 *
 * 用法: node scripts/cdp-run.mjs <port> scripts/verify-lyric-narrow.mjs
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rows = () => [...document.querySelectorAll('.results .row')]
const lyricRows = () => [...document.querySelectorAll('.lyric-line')]
const transRows = () => [...document.querySelectorAll('.lyric-line .lyric-trans')]
const infoItems = () => [...document.querySelectorAll('.lyric-info-item')].map((x) => x.textContent.trim())
const rail = (label) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(label)
  )

const CASES = [
  { query: 'Shape of You Ed Sheeran', want: 'Shape of You', plat: 'KG' },
  { query: 'Blinding Lights The Weeknd', want: 'Blinding Lights', plat: 'KG' },
  { query: 'Dynamite BTS', want: 'Dynamite', plat: 'KG' }
]

const out = []
for (const c of CASES) {
  rail('搜索')?.click()
  await sleep(900)
  const input = document.querySelector('.search-box input')
  input.focus()
  input.value = c.query
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(150)
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 20; i += 1) {
    await sleep(700)
    if (rows().length > 0) break
  }
  const cands = rows().map((row) => ({
    row,
    main: ((row.querySelector('.col-main') ?? {}).textContent ?? '').replace(/\s+/g, ' ').trim(),
    plat: ((row.querySelector('.col-platform') ?? {}).textContent ?? '').trim()
  }))
  const clean = (x) => !/伴奏|翻奏|dj|混音|remix|slowed|karaoke|纯音乐/i.test(x.main)
  const pick =
    cands.find((x) => x.main.startsWith(c.want) && x.plat === c.plat && clean(x)) ??
    cands.find((x) => x.main.startsWith(c.want) && clean(x))
  if (!pick) {
    out.push({ 歌: c.want, 结果: '候选缺失' })
    continue
  }
  ;(pick.row.querySelector('.col-actions button[title="播放"]') ?? pick.row).click()
  await sleep(2500)
  if (!location.hash.includes('now-playing')) {
    location.hash = '#/now-playing'
    await sleep(2000)
  }
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000)
    if (transRows().length > 0) break
  }
  await sleep(3000)

  const lyricTexts = lyricRows().map((line) =>
    String((line.querySelector('.lyric-main') ?? line).textContent ?? '').trim()
  )
  const untranslated = lyricRows()
    .filter((line) => !line.querySelector('.lyric-trans'))
    .map((line) => String((line.querySelector('.lyric-main') ?? line).textContent ?? '').trim())
    .filter((t) => t.length > 0)
  const metaLeak = lyricTexts.filter((t) =>
    /^(作词|作曲|编曲|制作人|和声|主人声|吉他|混音|母带|Producer|Writer|Composer|Sample)\s*[:：]/.test(t)
  )

  out.push({
    歌: c.want,
    歌曲信息行数: infoItems().length,
    歌曲信息样例: infoItems().slice(0, 3),
    歌词流行数: lyricRows().length,
    有译文行数: transRows().length,
    无译文行数: untranslated.length,
    无译文样例: untranslated.slice(0, 6),
    歌词流里残留的credits: metaLeak,
    判定:
      metaLeak.length === 0 && infoItems().length > 0
        ? '✓ credits 已分离，歌词流无残留'
        : metaLeak.length > 0
          ? '★ 歌词流里还有 credits'
          : '注：这首歌没有 credits 行'
  })
  await sleep(600)
}

return JSON.stringify({ 逐首: out }, null, 1)
