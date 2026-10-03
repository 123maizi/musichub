/**
 * 复现「歌在播、条子在 0 不动」。
 * 前置条件刻意做成和出问题那次一样：先拖几次进度条、去过详细页拖一次、再切歌。
 * 每秒读一次 .pb-state（组件内部状态出口），定位是四个原因中的哪一个。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

const rail = (l) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(l)
  )
const rows = () => [...document.querySelectorAll('.results .row')]
const state = () => {
  const el = document.querySelector('.pb-state')
  if (!el) return null
  const o = {}
  for (const a of el.attributes) o[a.name.replace('data-', '')] = a.value
  return o
}
const sx = () => {
  const f = document.querySelector('.progress-fill')
  if (!f) return null
  const m = /matrix\(([-\d.]+)/.exec(getComputedStyle(f).transform)
  return m ? Math.round(Number(m[1]) * 1000) / 10 : null
}
const fire = (sel, v) => {
  const el = document.querySelector(sel)
  if (!el) return false
  el.value = String(v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

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
const list = rows()

// ① 播一首，等一会
list[0]?.querySelector('.col-actions button[title="播放"]')?.click()
await sleep(8000)

// ② 拖几次底部进度条（含向后拖）
const input = document.querySelector('.progress-input')
for (const p of [50, 20, 70]) {
  fire('.progress-input', (p / 100) * Number(input.max))
  await sleep(1200)
}

// ③ 去详细页拖一次
location.hash = '#/now-playing'
for (let i = 0; i < 18; i += 1) {
  await sleep(500)
  if (document.querySelector('.seek-fill')) break
}
await sleep(1200)
const seekInput = document.querySelector('input.seek')
if (seekInput) fire('input.seek', Number(seekInput.max) * 0.4)
await sleep(1500)
rail('搜索')?.click()
await sleep(2000)

// ④ 切歌（这一步之后就是出问题的位置）
list[1]?.querySelector('.col-actions button[title="播放"]')?.click()

// ⑤ 每秒采样 20 秒
for (let i = 1; i <= 20; i += 1) {
  await sleep(1000)
  const s = state()
  out[`${i}s`] = s
    ? `sx=${sx()} display=${Number(s.display).toFixed(2)} progress=${Number(s.progress).toFixed(2)} cur=${Number(s.current).toFixed(1)} dur=${s.duration} seeking=${s.seeking} pending=${s.pending} playing=${s.playing}`
    : '没有状态出口'
}

const last = state()
out.结论 = !last
  ? '拿不到状态'
  : last.seeking === 'true'
    ? '★ seeking 卡在 true —— 界面被 seekValue 接管'
    : last.pending !== 'null'
      ? '★ pendingSeek 没释放'
      : Number(last.duration) <= 0
        ? '★ duration 为 0 —— 进度算不出来'
        : Math.abs(Number(last.progress) - Number(last.display)) < 0.5 && Number(last.progress) > 1
          ? '✓ 未复现：状态正常'
          : '★ progress 与 display 不一致，需看具体数值'

return JSON.stringify(out, null, 1)
