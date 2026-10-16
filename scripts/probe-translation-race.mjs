/**
 * 复现「换歌后译文整段丢失」的竞态。
 *
 * 1.4.9 的 loadTranslationOptions 开头有一句 `if (translationLoading.value) return`。
 * 它的本意是「同一首歌别重复请求」，实际效果是：**A 歌的译文还在路上时切到 B 歌，
 * B 歌的译文请求被整段丢掉** —— B 永远拿不到译文，界面上一行中文都没有。
 * 宽松匹配那一轮把请求拉长到最多几秒，窗口被显著拉大，于是表现为「很多歌都没译文了」。
 *
 * 本探针量三件事（同一构建、同一批歌）：
 *   B：在 A 的歌词刚显示出来（译文请求正在路上）时立刻切过去 —— 预期会丢译文
 *   C：等歌词显示后再等 6 秒才切过去 —— 对照组，预期正常
 *
 * 用法: node scripts/cdp-run.mjs <port> scripts/probe-translation-race.mjs
 * （探针里不能出现反引号 / ${} / 反斜杠 n）
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

const rows = () => [...document.querySelectorAll('.results .row')]
const lyricRows = () => [...document.querySelectorAll('.lyric-line')]
const transRows = () => [...document.querySelectorAll('.lyric-line .lyric-trans')]
const notes = () =>
  [...document.querySelectorAll('.lyric-bar .translate-note')].map((n) => n.textContent.trim())
const rail = (label) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(label)
  )

const search = async (keyword) => {
  rail('搜索')?.click()
  await sleep(1000)
  const input = document.querySelector('.search-box input')
  input.focus()
  input.value = keyword
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(150)
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 25; i += 1) {
    await sleep(800)
    if (rows().length > 0) break
  }
  return rows().map((row) => ({
    row,
    main: ((row.querySelector('.col-main') ?? {}).textContent ?? '').replace(/\s+/g, ' ').trim(),
    plat: ((row.querySelector('.col-platform') ?? {}).textContent ?? '').trim()
  }))
}

const play = (cand) => {
  const btn = cand.row.querySelector('.col-actions button[title="播放"]')
  ;(btn ?? cand.row).click()
}

const waitLyric = async (limitMs) => {
  const step = 150
  for (let t = 0; t < limitMs; t += step) {
    await sleep(step)
    if (lyricRows().length > 4) return t + step
  }
  return -1
}

const readNowPlaying = async (waitMs) => {
  if (!location.hash.includes('now-playing')) {
    location.hash = '#/now-playing'
    await sleep(1800)
  }
  await sleep(waitMs)
  /**
   * 必须一起读「当前是哪首歌」。
   * 我第一版漏了这个，结果把 A 歌的 92 行歌词当成了 B 歌的结果，
   * 差点得出「没复现」的结论 —— 其实 B 根本没开始播（播放条标题一直是 A）。
   */
  const title = (document.querySelector('.meta h1') ?? {}).textContent ?? ''
  return {
    曲名: String(title).trim().slice(0, 30),
    歌词行数: lyricRows().length,
    译文行数: transRows().length,
    提示: notes()
  }
}

const waitCurrentSong = async (want, limitMs) => {
  for (let t = 0; t < limitMs; t += 250) {
    await sleep(250)
    // 播放条上的曲名（任何路由都在），比只看正在播放页可靠
    const bar = String(document.querySelector('.player-bar .now-title')?.textContent ?? '')
    const meta = String(document.querySelector('.meta h1')?.textContent ?? '')
    if (bar.includes(want) || meta.includes(want)) return t + 250
  }
  return -1
}

/* ------------------------- 准备候选 ------------------------- */

const cands = await search('Ed Sheeran')
const pickA = cands.find((x) => x.main.startsWith('Shape of You') && x.plat === 'KG')
const pickB = cands.find((x) => x.main.startsWith('Perfect') && x.plat === 'KG')
const pickC = cands.find((x) => x.main.startsWith('Nothing On You') && x.plat === 'KG')
out.候选 = { A: pickA?.main, B: pickB?.main, C: pickC?.main }
if (!pickA || !pickB) return JSON.stringify({ 致命: '找不到候选行', ...out }, null, 1)

/* ------------------------- 1) 快切（命中竞态窗口） ------------------------- */

play(pickA)
const lyricMs = await waitLyric(30000)
out.A_歌词出现耗时ms = lyricMs
if (lyricMs < 0) return JSON.stringify({ 致命: 'A 歌歌词没出来', ...out }, null, 1)

// 歌词一出现就立刻切歌：此时 A 的译文请求必然还在路上
play(pickB)
const bSwitched = await waitCurrentSong('Perfect', 12000)
out.B_切歌生效耗时ms = bSwitched
out.B_切歌是否生效 = bSwitched >= 0 ? '是' : '否（B 没开始播，这轮数据作废）'
if (bSwitched < 0) return JSON.stringify(out, null, 1)

const bFast = await readNowPlaying(5000)
out.B_快切结果 = bFast

/* ------------------------- 2) 慢切（对照组） ------------------------- */

await sleep(500)
const cands2 = await search('Ed Sheeran')
const pickD = cands2.find((x) => x.main.startsWith('Shape of You') && x.plat === 'KG') ?? pickA
const pickC2 = cands2.find((x) => x.main.startsWith('Perfect') && x.plat === 'KG') ?? pickB
if (pickC2 && pickD) {
  play(pickD)
  await waitLyric(30000)
  await sleep(7000) // 让 D 的译文请求彻底跑完，再切
  play(pickC2)
  const ok = await waitCurrentSong('Perfect', 12000)
  out.C_切歌生效 = ok >= 0 ? '是' : '否'
  if (ok >= 0) {
    const cSlow = await readNowPlaying(5000)
    out.C_慢切结果 = cSlow
    out.对照组 = cSlow.译文行数
  }
}

out.判定 =
  (bFast.译文行数 ?? 0) === 0 && (out.对照组 ?? 0) > 5
    ? '★ 复现：快切后译文整段丢失（' + bFast.译文行数 + ' 行），慢切正常（' + out.对照组 + ' 行）'
    : out.对照组 === undefined
      ? '⊘ 对照轮没跑起来，本轮不作结论'
      : '✓ 未复现：快切 ' + bFast.译文行数 + ' 行 / 慢切 ' + out.对照组 + ' 行'

return JSON.stringify(out, null, 1)
