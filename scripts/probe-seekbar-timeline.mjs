/**
 * 专测「正在播放页」的进度条（.seek-fill），用队列切歌 —— 这才是用户报的场景。
 * 50ms 高频采样 4 秒。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

const rail = (label) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(label)
  )

rail('搜索')?.click()
await sleep(2200)

const rows = () => [...document.querySelectorAll('.results .row')]
if (rows().length === 0) {
  const inp = document.querySelector('.search-box input')
  inp.focus()
  inp.value = '周杰伦'
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(300)
  inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    if (rows().length > 0) break
  }
}

const readPct = (sel) => {
  const el = document.querySelector(sel)
  if (!el) return null
  const t = getComputedStyle(el).transform
  const m = /matrix\(([-\d.]+)/.exec(t)
  return m ? Math.round(Number(m[1]) * 1000) / 10 : null
}
const seekPct = () => readPct('.seek-fill')
const barPct = () => readPct('.progress-fill')
const npTitle = () => (document.querySelector('.meta h1, .stage h1, .seek-wrap') ? (document.querySelector('.meta h1')?.textContent ?? '').trim().slice(0, 12) : '')
const seekTime = () => {
  const el = document.querySelector('.seek-time, .time-row')
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null
}

// 播第一首 → 进正在播放页
rows()[0]?.querySelector('.col-actions button[title="播放"]')?.click()
await sleep(3000)
location.hash = '#/now-playing'
for (let i = 0; i < 20; i += 1) {
  await sleep(500)
  if (document.querySelector('.seek-fill')) break
}
await sleep(12000)

out.切歌前 = { 正在播放页: !!document.querySelector('.seek-fill'), 标题: npTitle(), seek进度: seekPct(), 播放条进度: barPct(), 时间: seekTime() }

// 用「下一首」按钮切歌
const nextBtn =
  [...document.querySelectorAll('.stage button, .page button')].find((b) =>
    /下一首|next/i.test((b.getAttribute('title') ?? '') + (b.getAttribute('aria-label') ?? ''))
  ) ?? [...document.querySelectorAll('footer.player-bar button')].find((b) => /下一首|next/i.test(b.getAttribute('title') ?? ''))

out.下一首按钮 = nextBtn ? (nextBtn.getAttribute('title') || nextBtn.getAttribute('aria-label') || '找到').slice(0, 12) : '没找到'
if (!nextBtn) return JSON.stringify(out, null, 1)

const t0 = performance.now()
nextBtn.click()
const line = []
for (let i = 0; i < 80; i += 1) {
  await sleep(50)
  line.push({ ms: Math.round(performance.now() - t0), s: seekPct(), b: barPct() })
}
out.时间线_seek = line.map((x) => `${x.ms}:${x.s}`).join(' ')
out.时间线_播放条 = line.map((x) => `${x.ms}:${x.b}`).join(' ')
out.切歌后 = { 标题: npTitle(), seek进度: seekPct(), 播放条进度: barPct(), 时间: seekTime() }

const early = line.filter((x) => x.ms <= 1500)
const maxSeek = Math.max(...early.map((x) => x.s ?? 0))
const maxBar = Math.max(...early.map((x) => x.b ?? 0))
out.判定 = {
  切歌前seek: out.切歌前.seek进度,
  '前1_5秒seek最大': maxSeek,
  '前1_5秒播放条最大': maxBar,
  结论: maxSeek <= Math.max(1, (out.切歌前.seek进度 ?? 0) * 0.3) ? '✓ 正在播放页也无残留' : '★ 正在播放页有残留'
}

return JSON.stringify(out, null, 1)
