/**
 * 回归验收：快速换歌时，第二首歌会不会整段丢译文。
 *
 * 用户报的是「很多本来有一半中文歌词的歌，现在全都没有中文翻译了」。
 * 触发条件就是**在上一首的译文请求还没回来时切歌** ——
 * 1.4.9 在 loadTranslationOptions 开头写了 `if (translationLoading.value) return`，
 * 于是第二首的请求被整段丢掉，它永远拿不到译文。
 *
 * 所以这里刻意复刻那个动作：点 A 播放 → 1.2 秒后立刻点 B 播放（同一份搜索结果里），
 * 再到正在播放页读**真正渲染出来的**译文行数。判定标准只有一条：
 * 本来平台有译文的歌，不能出现「0 行译文」。
 *
 * 用法: node scripts/cdp-run.mjs <port> scripts/verify-translation-fastswitch.mjs
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rows = () => [...document.querySelectorAll('.results .row')]
const lyricRows = () => [...document.querySelectorAll('.lyric-line')]
const transRows = () => [...document.querySelectorAll('.lyric-line .lyric-trans')]
const notes = () =>
  [...document.querySelectorAll('.lyric-bar .translate-note')]
    .map((n) => n.textContent.trim())
    .join(' / ')
const rail = (label) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(label)
  )

const search = async (keyword) => {
  rail('搜索')?.click()
  await sleep(900)
  const input = document.querySelector('.search-box input')
  input.focus()
  input.value = keyword
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(150)
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 20; i += 1) {
    await sleep(700)
    if (rows().length > 0) break
  }
  return rows().map((row) => ({
    row,
    main: ((row.querySelector('.col-main') ?? {}).textContent ?? '').replace(/\s+/g, ' ').trim(),
    plat: ((row.querySelector('.col-platform') ?? {}).textContent ?? '').trim()
  }))
}

const playRow = (cand) => {
  const btn = cand.row.querySelector('.col-actions button[title="播放"]')
  ;(btn ?? cand.row).click()
}

const waitTitle = async (want, limitMs) => {
  for (let t = 0; t < limitMs; t += 200) {
    await sleep(200)
    const bar = String(document.querySelector('.player-bar .now-title')?.textContent ?? '')
    if (bar.includes(want)) return true
  }
  return false
}

/** 每组：同一份搜索结果里的两首歌，A 播 1.2 秒后立刻切 B */
const GROUPS = [
  { query: 'Ed Sheeran', a: 'Shape of You', b: 'Perfect' },
  { query: 'The Weeknd', a: 'Blinding Lights', b: 'Save Your Tears' },
  { query: 'Ed Sheeran', a: 'Photograph', b: 'Nothing On You' },
  { query: 'Ariana Grande', a: 'Into You', b: 'No Tears Left To Cry' }
]

const out = []
for (const g of GROUPS) {
  const cands = await search(g.query)
  const clean = (x) => !/伴奏|翻奏|dj|混音|remix|slowed|karaoke|纯音乐/i.test(x.main)
  const pickA = cands.find((x) => x.main.startsWith(g.a) && clean(x))
  const pickB = cands.find((x) => x.main.startsWith(g.b) && clean(x))
  if (!pickA || !pickB) {
    out.push({ 组: g.a + ' → ' + g.b, 结果: '候选缺失（A=' + Boolean(pickA) + ' B=' + Boolean(pickB) + '）' })
    continue
  }

  playRow(pickA)
  await sleep(1200) // ← 关键：此时 A 的译文请求几乎肯定还在路上
  playRow(pickB)

  const switched = await waitTitle(g.b, 25000)
  if (!switched) {
    out.push({ 组: g.a + ' → ' + g.b, 结果: '★ B 没开始播，本组数据作废' })
    continue
  }

  // 进正在播放页读渲染结果
  if (!location.hash.includes('now-playing')) {
    location.hash = '#/now-playing'
    await sleep(2000)
  }
  // 等歌词 + 译文 + 后台补齐都落定
  for (let i = 0; i < 40; i += 1) {
    await sleep(1000)
    if (transRows().length > 0) break
  }
  await sleep(12000)

  out.push({
    组: g.a + ' → ' + g.b,
    第二首: g.b,
    歌词行数: lyricRows().length,
    译文行数: transRows().length,
    提示: notes(),
    判定: transRows().length > 0 ? '✓ 第二首有译文' : '★ 第二首 0 行译文（就是用户报的症状）'
  })
  await sleep(800)
}

const bad = out.filter((r) => String(r.判定 ?? '').startsWith('★')).length
return JSON.stringify(
  {
    逐组: out,
    丢译文的组数: bad,
    总判定: bad === 0 ? '✓ 快速换歌不再丢译文' : '★ 仍有 ' + bad + ' 组丢译文'
  },
  null,
  1
)
