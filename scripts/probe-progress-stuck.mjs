/**
 * 播一首歌后，按秒采样 20 秒：
 *   进度条 percent（从 --p 和 transform 两处读，交叉验证）
 *   播放条时间文本
 *   进度输入框的 max（= duration，用于判断分母是否为 0）
 * 目的：分辨「进度条一直不动」还是「某一瞬间读到 0」。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { 时间线: [] }

const rail = (l) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(l)
  )
const rows = () => [...document.querySelectorAll('.results .row')]

const read = () => {
  const railEl = document.querySelector('.progress-rail')
  const fill = document.querySelector('.progress-fill')
  const input = document.querySelector('.progress-input')
  const p = railEl ? getComputedStyle(railEl).getPropertyValue('--p').trim() : null
  const m = fill ? /matrix\(([-\d.]+)/.exec(getComputedStyle(fill).transform) : null
  return {
    p: p === '' ? '空' : p,
    sx: m ? Math.round(Number(m[1]) * 1000) / 10 : null,
    时间: (document.querySelector('.player-bar .time-row')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    max: input ? input.max : null,
    range值: input ? input.value : null,
    曲目: (document.querySelector('.player-bar .now-title')?.textContent ?? '').trim().slice(0, 8)
  }
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

out.播放前 = read()
rows()[0]?.querySelector('.col-actions button[title="播放"]')?.click()

for (let i = 1; i <= 20; i += 1) {
  await sleep(1000)
  const r = read()
  out.时间线.push(`${i}s sx=${r.sx} --p=${r.p} 时间=${r.时间} max=${r.max} 值=${r.range值}`)
}

out.末尾 = read()
const stuck = out.时间线.filter((l) => /sx=0 /.test(l) || /sx=0\.0 /.test(l)).length
out.判定 = stuck >= 15 ? '★ 进度条长时间停在 0（时间在走但条子不动）' : `进度条正常推进（停在0的采样数 ${stuck}/20）`

return JSON.stringify(out, null, 1)
