/**
 * 耐心测封面覆盖率：滚完整张列表后，等到读数连续 4 次不变才下结论。
 * （验收脚本里是「一变就不变就停」，在列表刚被重新搜索过时会过早收工。）
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = document.querySelector('.list, .results')
const count = () => {
  const rows = [...document.querySelectorAll('.results .row')]
  let img = 0
  let ok = 0
  const failed = []
  for (const r of rows) {
    const el = r.querySelector('.mini-cover img, .cover img')
    if (!el) continue
    img++
    if (el.complete && el.naturalWidth > 0) ok++
    else if (failed.length < 6) failed.push((r.querySelector('.title')?.innerText ?? '').trim().slice(0, 14))
  }
  return { 行数: rows.length, 有img: img, 已加载: ok, 未加载: failed }
}

// 滚到底再滚回顶，触发懒加载
if (list) {
  for (let y = 0; y <= list.scrollHeight; y += 300) {
    list.scrollTop = y
    await sleep(80)
  }
  list.scrollTop = list.scrollHeight
  await sleep(1500)
  list.scrollTop = 0
}
await sleep(1000)

let last = -1
let same = 0
const timeline = []
for (let i = 0; i < 40; i += 1) {
  await sleep(1500)
  const c = count()
  timeline.push(c.已加载 + '/' + c.有img)
  if (c.已加载 === last) {
    same += 1
    if (same >= 4) break
  } else {
    same = 0
    last = c.已加载
  }
}

return JSON.stringify({ 最终: count(), 读数轨迹: timeline }, null, 1)
