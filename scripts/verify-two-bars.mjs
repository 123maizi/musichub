/**
 * 验证两个进度条互不干扰：
 *   ① 反复「向前/向后」seek 底部播放条 → 每次都要落到目标位置
 *   ② 交替拖「正在播放页」与「播放条」→ 另一边必须跟着走
 * 重点测**向后 seek**（读回值不可信的场景）与**交替**（互相干扰的场景）。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { 底部seek: [], 交替: [] }

const rail = (l) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(l)
  )
const rows = () => [...document.querySelectorAll('.results .row')]
const pct = (sel) => {
  const el = document.querySelector(sel)
  if (!el) return null
  const m = /matrix\(([-\d.]+)/.exec(getComputedStyle(el).transform)
  return m ? Math.round(Number(m[1]) * 1000) / 10 : null
}
const barPct = () => pct('.progress-fill')
const seekPct = () => pct('.seek-fill')

rail('搜索')?.click()
await sleep(2200)
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
rows()[0]?.querySelector('.col-actions button[title="播放"]')?.click()
await sleep(6000)

/** 模拟拖动进度条：写 value + 派发 input/change（组件就是听这两个事件） */
const dragTo = async (sel, percent) => {
  const el = document.querySelector(sel)
  if (!el) return '找不到输入框 ' + sel
  const max = Number(el.max) || 100
  const v = String(Math.round((percent / 100) * max * 10) / 10)
  el.value = v
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(80)
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return null
}

/* ① 底部播放条：连续向前/向后 seek */
for (const target of [60, 20, 80, 10, 45, 5]) {
  await sleep(2500)
  const before = barPct()
  await dragTo('.progress-input', target)
  await sleep(1200)
  const after = barPct()
  out.底部seek.push({
    目标: target + '%',
    seek前: before,
    落地: after,
    偏差: after === null ? null : Math.round((after - target) * 10) / 10,
    判定: after !== null && Math.abs(after - target) <= 3 ? '✓' : '★ 没落到目标'
  })
}

/* ② 交替：正在播放页 ↔ 播放条 */
location.hash = '#/now-playing'
for (let i = 0; i < 18; i += 1) {
  await sleep(500)
  if (document.querySelector('.seek-fill')) break
}
await sleep(1500)

for (const target of [70, 25, 55]) {
  // 先拖正在播放页
  await dragTo('input.seek', target)
  await sleep(1200)
  const top = seekPct()
  const bottomAfterTop = barPct()
  // 再拖播放条
  await dragTo('.progress-input', 30)
  await sleep(1200)
  const bottom = barPct()
  const topAfterBottom = seekPct()
  out.交替.push({
    拖详细页到: target + '%',
    详细页落地: top,
    此时播放条: bottomAfterTop,
    播放条跟上了吗: bottomAfterTop !== null && Math.abs(bottomAfterTop - target) <= 4 ? '✓' : '★ 没跟上',
    再拖播放条到: '30%',
    播放条落地: bottom,
    详细页跟上了吗: topAfterBottom !== null && Math.abs(topAfterBottom - 30) <= 4 ? '✓' : '★ 没跟上'
  })
}

out.汇总 = {
  底部seek失败数: out.底部seek.filter((x) => x.判定 !== '✓').length,
  交替失败数: out.交替.filter((x) => x.播放条跟上了吗 !== '✓' || x.详细页跟上了吗 !== '✓').length
}

return JSON.stringify(out, null, 1)
