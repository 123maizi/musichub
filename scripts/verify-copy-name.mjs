/** 验证复制歌名：按钮存在、点击后有「已复制」反馈、剪贴板内容正确 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const rail = (l) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(l)
  )
const rows = () => [...document.querySelectorAll('.results .row')]

rail('搜索')?.click()
await sleep(2500)
if (rows().length === 0) {
  const inp = document.querySelector('.search-box input')
  inp.focus()
  inp.value = '周杰伦'
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(250)
  inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    if (rows().length > 0) break
  }
}
const list = rows()
if (!list.length) return JSON.stringify({ 错误: '无搜索结果' }, null, 1)

// 表格里的复制按钮
const copyBtn = [...list[0].querySelectorAll('.col-actions button')].find((b) =>
  /复制歌名/.test(b.getAttribute('title') ?? '')
)
out.表格复制按钮 = copyBtn ? '存在（' + copyBtn.getAttribute('title') + '）' : '★ 没找到'

const title = (list[0].querySelector('.title')?.textContent ?? '').trim()
const singer = (list[0].querySelector('.singer')?.textContent ?? '').trim()
out.该行 = title + ' — ' + singer

if (copyBtn) {
  copyBtn.click()
  await sleep(400)
  out.点击后标题 = copyBtn.getAttribute('title')
  out.反馈判定 = /已复制/.test(copyBtn.getAttribute('title') ?? '') ? '✓ 出现「已复制」反馈' : '★ 无反馈'
  try {
    const text = await navigator.clipboard.readText()
    out.剪贴板内容 = text
    out.内容判定 = text.includes(title) ? '✓ 内容包含歌名' : '★ 内容不对'
  } catch (e) {
    out.剪贴板内容 = '读取被拒绝（' + String(e).slice(0, 40) + '）'
  }
  await sleep(1300)
  out.反馈自动恢复 = /复制歌名/.test(copyBtn.getAttribute('title') ?? '') ? '✓ 1.4 秒后恢复' : '★ 没恢复'
}

// 播放条里的复制按钮
list[0]?.querySelector('.col-actions button[title="播放"]')?.click()
await sleep(4000)
const barBtn = [...document.querySelectorAll('footer.player-bar .tools button')].find((b) =>
  /复制歌名/.test(b.getAttribute('title') ?? '')
)
out.播放条复制按钮 = barBtn ? '存在' : '★ 没找到'
if (barBtn) {
  barBtn.click()
  await sleep(400)
  out.播放条反馈 = /已复制/.test(barBtn.getAttribute('title') ?? '') ? '✓ 有反馈' : '★ 无反馈'
  try {
    out.播放条剪贴板 = await navigator.clipboard.readText()
  } catch {
    out.播放条剪贴板 = '读取被拒绝'
  }
}

return JSON.stringify(out, null, 1)
