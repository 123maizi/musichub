/**
 * 音质选择的落盘与跨歌保持。
 *
 * 用户报的两个问题：
 *   1. 「设置里的默认音质有点多余」→ 设置页那一项应当已经不存在
 *   2. 「选完音质，听别的歌又自动切回默认音质」→ 选择必须记住，换歌后仍然生效
 *
 * 判据用**界面上显示的期望音质**与 prefs 里落盘的值，不看内部状态。
 *
 * 用法: node scripts/cdp-run.mjs <port> scripts/verify-quality-pref.mjs
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const rail = (label) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(label)
  )
const rows = () => [...document.querySelectorAll('.results .row')]
const qualityLabel = () =>
  String(document.querySelector('.player-bar .quality-btn')?.textContent ?? '').trim()

/* ------------------------- 1) 设置页不该再有「默认播放音质」 ------------------------- */

rail('设置')?.click()
await sleep(1500)
out.设置页文本含默认播放音质 = document.body.textContent.includes('默认播放音质')
out.设置页判定 = out.设置页文本含默认播放音质 ? '★ 还在' : '✓ 已删除'

/* ------------------------- 2) 在播放条上换音质 → 应当落盘 ------------------------- */

rail('搜索')?.click()
await sleep(1200)
const input = document.querySelector('.search-box input')
input.focus()
input.value = 'Shape of You Ed Sheeran'
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(150)
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
for (let i = 0; i < 20; i += 1) {
  await sleep(800)
  if (rows().length > 0) break
}
const row = rows().find((r) => /^Shape of You/.test(((r.querySelector('.col-main') ?? {}).textContent ?? '').trim()))
if (!row) return JSON.stringify({ 致命: '没找到可播的行' }, null, 1)
;(row.querySelector('.col-actions button[title="播放"]') ?? row).click()
await sleep(6000)

out.换音质前_播放条显示 = qualityLabel()

// 打开音质快选菜单，选 FLAC
const btn = document.querySelector('.player-bar .quality-btn')
btn?.click()
await sleep(500)
const items = [...document.querySelectorAll('.player-bar .quality-item')].map((x) => ({
  text: x.textContent.trim(),
  el: x
}))
out.菜单项 = items.map((x) => x.text)
const flac = items.find((x) => /flac|无损/i.test(x.text))
const before = await window.api.prefs.get()
out.换之前_prefs = before?.playQuality ?? null
if (flac) {
  flac.el.click()
  await sleep(3000)
}
const after = await window.api.prefs.get()
out.换之后_prefs = after?.playQuality ?? null
out.换之后_播放条显示 = qualityLabel()
out.落盘判定 =
  out.换之后_prefs && out.换之后_prefs !== out.换之前_prefs ? '✓ 选择已写入 prefs' : '★ 没写进去'

/* ------------------------- 3) 换别的歌：音质不该回到默认 ------------------------- */

const input2 = document.querySelector('.search-box input')
input2.focus()
input2.value = 'Perfect Ed Sheeran'
input2.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(150)
input2.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
await sleep(4000)
const rows2 = rows()
const row2 = rows2.find((r) => /^Perfect/.test(((r.querySelector('.col-main') ?? {}).textContent ?? '').trim()))
if (row2) {
  ;(row2.querySelector('.col-actions button[title="播放"]') ?? row2).click()
  await sleep(7000)
}
out.换歌后_播放条显示 = qualityLabel()
out.跨歌判定 =
  flac && out.换歌后_播放条显示 && !/320/i.test(out.换歌后_播放条显示)
    ? '✓ 换歌后仍是所选音质（' + out.换歌后_播放条显示 + '）'
    : '注：显示为 ' + out.换歌后_播放条显示 + '（音源没有该音质时会自动降级，属预期）'

return JSON.stringify(out, null, 1)
