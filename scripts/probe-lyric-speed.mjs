/**
 * 歌词出现耗时（用户感知的那一段）。
 *
 * 用户的原话：「先获取英文原版歌词再获取中文翻译歌词，不然它一直卡好久才显示歌词，
 * 让人误以为没有歌词」。所以要量的就是**点播放 → 屏幕上出现第一行歌词**的墙钟时间。
 *
 * 判据必须是页面上真的出现了 .lyric-line —— 内部状态不算数。
 * 为了不受路由影响，点完播放立刻切到正在播放页开始计时。
 *
 * 用法: node scripts/cdp-run.mjs <port> scripts/probe-lyric-speed.mjs
 * （探针里不能出现反引号 / ${} / 反斜杠 n）
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rows = () => [...document.querySelectorAll('.results .row')]
const lyricRows = () => [...document.querySelectorAll('.lyric-line')]
const transRows = () => [...document.querySelectorAll('.lyric-line .lyric-trans')]
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

const watch = async (want, limitMs) => {
  const t0 = performance.now()
  for (let t = 0; t < limitMs; t += 100) {
    await sleep(100)
    const bar = String(document.querySelector('.player-bar .now-title')?.textContent ?? '')
    if (bar.includes(want)) return Math.round(performance.now() - t0)
  }
  return -1
}

const CASES = [
  { query: 'Shape of You Ed Sheeran', want: 'Shape of You', plat: 'KG' },
  { query: 'Lemon 米津玄師', want: 'Lemon', plat: 'KW' },
  { query: 'Blinding Lights The Weeknd', want: 'Blinding Lights', plat: 'KG' },
  { query: 'Dandelions Ruth B', want: 'Dandelions', plat: 'KG' }
]

const out = []
for (const c of CASES) {
  const cands = await search(c.query)
  const pick =
    cands.find((x) => x.main.startsWith(c.want) && x.plat === c.plat && !/伴奏|翻奏|dj|混音|remix|slowed/i.test(x.main)) ??
    cands.find((x) => x.main.startsWith(c.want) && !/伴奏|翻奏|dj|混音|remix|slowed/i.test(x.main))
  if (!pick) {
    out.push({ 歌: c.want, 结果: '找不到候选' })
    continue
  }

  const btn = pick.row.querySelector('.col-actions button[title="播放"]')
  const t0 = performance.now()
  ;(btn ?? pick.row).click()
  // 立刻切到正在播放页开始计时
  location.hash = '#/now-playing'

  // 第一行歌词出现
  let first = -1
  for (let t = 0; t < 40000; t += 150) {
    await sleep(150)
    if (lyricRows().length > 0) {
      first = Math.round(performance.now() - t0)
      break
    }
  }

  // 再等中文译文补齐
  let transAt = -1
  for (let t = 0; t < 30000; t += 250) {
    await sleep(250)
    if (transRows().length > 0) {
      transAt = Math.round(performance.now() - t0)
      break
    }
  }

  /**
   * 等**固定的足够长时间**再读终态。
   *
   * ⚠️ 不能写成「连续两次采样相同就算稳定」—— 补齐是在后台跑的，
   * 它会先安静好几秒（在等接口），那种写法第一次就判定「稳定」，
   * 量到的其实是补齐之前的初始值。我就这么被骗过一轮：
   * 新旧构建读出来的数字一模一样，看起来像「补齐根本没生效」。
   */
  await sleep(35000)
  const stable = transRows().length

  out.push({
    歌: c.want,
    歌词出现ms: first,
    首行译文出现ms: transAt,
    歌词行数: lyricRows().length,
    译文行数: stable,
    未译行数: lyricRows().length - stable,
    /** 剩下没译文的到底是哪些行 —— 用来确认残留的是信息行（作词/作曲/制作人）而不是歌词 */
    未译样例: [...document.querySelectorAll('.lyric-line')]
      .filter((line) => !line.querySelector('.lyric-trans'))
      .map((line) => String(line.textContent).trim().slice(0, 34))
      .filter((t) => t.length > 0)
      .slice(0, 10)
  })
  await sleep(600)
}

const firsts = out.map((x) => x.歌词出现ms).filter((v) => typeof v === 'number' && v > 0)
return JSON.stringify(
  {
    逐首: out,
    歌词出现_中位数ms: firsts.length ? firsts.sort((a, b) => a - b)[Math.floor(firsts.length / 2)] : null,
    歌词出现_最大ms: firsts.length ? Math.max(...firsts) : null
  },
  null,
  1
)
