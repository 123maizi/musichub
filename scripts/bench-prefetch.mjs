/**
 * 实测预热效果：对比「直接点播放」与「先悬停一下再点」的出声耗时。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const rail = (l) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(l)
  )
const rows = () => [...document.querySelectorAll('.results .row')]
const playing = () => {
  const st = document.querySelector('.pb-state')
  return st ? st.getAttribute('data-playing') === 'true' : false
}

rail('搜索')?.click()
await sleep(2500)
if (rows().length === 0) {
  const inp = document.querySelector('.search-box input')
  inp.focus()
  inp.value = '陈奕迅'
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(250)
  inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    if (rows().length > 0) break
  }
}
const list = rows()
out.搜索结果 = list.length
if (list.length < 5) return JSON.stringify(out, null, 1)

const titleNow = () =>
  (document.querySelector('.player-bar .now-title')?.textContent ?? '').trim()

/**
 * 点击某一行并测「点击到出声」耗时。
 *
 * 判据必须落在**真正出声**上：标题在 play() 一开始就变了（current.value = song），
 * playing 也还是上一首的稳态 true —— 只判这两个会把耗时测成 40ms 的假象。
 * 所以等「标题已换 + 播放位置刚开始走」（新歌从头播，current 落在几秒内）。
 */
const clickAndTime = async (i) => {
  const btn = list[i]?.querySelector('.col-actions button[title="播放"]')
  if (!btn) return null
  const before = titleNow()
  const t0 = performance.now()
  btn.click()
  for (let k = 0; k < 800; k += 1) {
    await sleep(10)
    const st = document.querySelector('.pb-state')
    if (!st || titleNow() === before) continue
    const cur = Number(st.getAttribute('data-current'))
    if (st.getAttribute('data-playing') === 'true' && cur > 0.15 && cur < 6) {
      return Math.round(performance.now() - t0)
    }
  }
  return null
}

/* 选**没播过**的行：判据是「标题变了」，重复点同一首永远不会变 */
const cur = titleNow()
const fresh = []
for (let i = 6; i < list.length && fresh.length < 6; i += 1) {
  const t = (list[i].querySelector('.title')?.textContent ?? '').trim()
  if (t && t !== cur) fresh.push(i)
}
out.选中的行 = fresh

/* ① 不预热：直接点 */
const cold = []
for (const i of fresh.slice(0, 2)) {
  await sleep(1200)
  const ms = await clickAndTime(i)
  if (ms !== null) cold.push(ms)
}
out.直接点击 = cold.map((m) => m + 'ms')

/* ② 先悬停预热，再点 */
const warm = []
for (const i of fresh.slice(2, 4)) {
  // 模拟鼠标停在该行上：派发 mouseenter，然后等预热完成
  list[i].dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
  await sleep(900)
  const ms = await clickAndTime(i)
  if (ms !== null) warm.push(ms)
}
out.先悬停再点 = warm.map((m) => m + 'ms')

const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null)
out.统计 = {
  直接点击平均: avg(cold) === null ? '无样本' : avg(cold) + 'ms',
  悬停预热后平均: avg(warm) === null ? '无样本' : avg(warm) + 'ms',
  提速: avg(cold) && avg(warm) ? Math.round((1 - avg(warm) / avg(cold)) * 100) + '%' : '无法比较'
}
out.判定 =
  avg(warm) !== null && avg(warm) <= 150
    ? '✓ 预热后基本「点下去就出声」'
    : avg(warm) !== null && avg(cold) !== null && avg(warm) < avg(cold) * 0.6
      ? '✓ 预热有明显提速'
      : '★ 预热效果不明显'

return JSON.stringify(out, null, 1)
