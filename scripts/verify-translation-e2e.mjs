/**
 * 端到端：官方译文在界面上的三种状态。
 *
 * 判据只用**页面真正渲染出来的东西**（.lyric-line / .lyric-trans / .translate-note），
 * 内部状态一概不看 —— 用户看到的就是这几样。
 *
 * 三个场景：
 *   1. 英文歌 + 平台有现成译文 → 应当自动出现大量中文译文行
 *   2. 中文歌 → 不该出现「没有中文译文」的提示（歌词本来就是中文，那是噪音）
 *   3. 英文歌 + 平台没有现成译文 → 应当出现「没找到、可用 AI 翻」的明确提示，
 *      而不是像以前那样一片沉默让用户干等
 *
 * 用法: node scripts/cdp-run.mjs <port> scripts/verify-translation-e2e.mjs
 * （探针里不能出现反引号 / ${} / 反斜杠 n）
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = []

const rows = () => [...document.querySelectorAll('.results .row')]
const lyricRows = () => [...document.querySelectorAll('.lyric-line')]
const transRows = () => [...document.querySelectorAll('.lyric-line .lyric-trans')]
const notes = () =>
  [...document.querySelectorAll('.lyric-bar .translate-note')].map((n) => n.textContent.trim())
const rail = (label) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(label)
  )

const SCENARIOS = [
  {
    name: '英文歌 + 有现成译文',
    query: 'Dandelions Ruth B',
    target: 'Dandelions',
    plat: 'KG',
    /** 同名条目里挑主单元格最短的那条 —— 封面/混音版会带一长串后缀 */
    shortest: true,
    expect: 'many'
  },
  {
    name: '中文歌（不该提示缺中文译文）',
    query: '晴天 周杰伦',
    target: '晴天',
    plat: 'QQ',
    shortest: true,
    expect: 'noHint'
  },
  {
    name: '英文歌 + 平台无现成译文（应给明确提示）',
    query: 'Shape of You',
    target: 'Shape of You',
    plat: 'KG',
    /** 翻唱组合版：有歌词、但平台侧没有任何现成译文（探针实测过这一条） */
    mustInclude: 'Music Travel Love',
    expect: 'hint'
  }
]

for (const s of SCENARIOS) {
  const r = { 场景: s.name }

  rail('搜索')?.click()
  await sleep(1200)

  const input = document.querySelector('.search-box input')
  if (!input) {
    r.致命 = '找不到搜索框'
    out.push(r)
    continue
  }
  input.focus()
  input.value = s.query
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(200)
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))

  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    if (rows().length > 0) break
  }

  const cand = rows()
    .map((row) => ({
      row,
      main: ((row.querySelector('.col-main') ?? {}).textContent ?? '').replace(/\s+/g, ' ').trim(),
      plat: ((row.querySelector('.col-platform') ?? {}).textContent ?? '').trim()
    }))
    .filter((x) => x.main.includes(s.target) && (!s.mustInclude || x.main.includes(s.mustInclude)))

  const clean = (x) => !/伴奏|翻奏|dj|混音|remix|slowed|karaoke|纯音乐/i.test(x.main)
  let pick = cand.find((x) => x.plat === s.plat && clean(x))
  if (!pick) pick = cand.find(clean)
  if (s.shortest && cand.length > 1) {
    const samePlat = cand.filter((x) => (pick ? x.plat === pick.plat : true) && clean(x))
    samePlat.sort((a, b) => a.main.length - b.main.length)
    if (samePlat[0]) pick = samePlat[0]
  }

  r.候选数 = cand.length
  r.选中 = pick ? pick.plat + ' | ' + pick.main.slice(0, 34) : '没找到'
  if (!pick) {
    out.push(r)
    continue
  }

  const btn = pick.row.querySelector('.col-actions button[title="播放"]')
  ;(btn ?? pick.row).click()

  for (let i = 0; i < 40; i += 1) {
    await sleep(1000)
    if (lyricRows().length > 4) break
  }

  // 不导航：正在播放页是另一个路由，这里直接切过去看译文面板
  location.hash = '#/now-playing'
  await sleep(3500)

  r.歌词行数 = lyricRows().length
  r.译文行数 = transRows().length
  r.提示 = notes()
  r.样例 = transRows()
    .slice(0, 3)
    .map((t) => String(t.textContent).trim().slice(0, 24))

  if (s.expect === 'many') {
    const bogus = r.提示.some((n) => n.includes('AI 翻译'))
    r.判定 =
      r.译文行数 >= 10
        ? bogus
          ? '★ 有译文却挂着错误的来源标签'
          : '✓ ' + r.译文行数 + ' 行中文译文（共 ' + r.歌词行数 + ' 行），来源标签正确'
        : '★ 译文太少'
  } else if (s.expect === 'noHint') {
    const hasMissingHint = r.提示.some((n) => n.includes('没有现成中文译文'))
    const bogus = r.提示.some((n) => n.includes('AI 翻译'))
    r.判定 = hasMissingHint
      ? '★ 中文歌不该提示缺中文译文'
      : bogus
        ? '★ 没有译文却挂着「本歌词由 AI 翻译」'
        : '✓ 无译文时不挂任何来源标签，也不提示缺中文译文'
  } else {
    const hasMissingHint = r.提示.some((n) => n.includes('没有现成中文译文'))
    const bogus = r.提示.some((n) => n.includes('AI 翻译'))
    r.判定 = hasMissingHint
      ? bogus
        ? '★ 提示里混进了错误的来源标签'
        : '✓ 明确告知没找到，并指路 AI，且不挂假标签'
      : '★ 仍然一片沉默：' + JSON.stringify(r.提示)
  }

  out.push(r)
}

const failed = out.filter((r) => String(r.判定 ?? '').startsWith('★')).length
return JSON.stringify({ 场景结果: out, 失败数: failed, 总判定: failed === 0 ? '✓ 三种状态都正确' : '★ 有场景不对' }, null, 1)
