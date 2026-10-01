/** 造一条搜索历史，再验证下拉真的能打开并可用 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

const input = document.querySelector('.search-box input')
const dropdown = () => document.querySelector('.history-pop')

// 1) 真正搜一次（应写入历史）
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(200)
input.value = '周杰伦'
input.dispatchEvent(new Event('input', { bubbles: true }))
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
for (let i = 0; i < 25; i += 1) {
  await sleep(1000)
  if (document.querySelectorAll('.results .row').length > 0) break
}
out.搜索后行数 = document.querySelectorAll('.results .row').length

// 2) 看历史是否写入
let prefs = null
try {
  prefs = await window.api.prefs.get()
} catch {
  /* ignore */
}
out.历史 = { 条数: (prefs?.searchHistory ?? []).length, 内容: (prefs?.searchHistory ?? []).slice(0, 5) }

// 3) 清空输入 → 聚焦 → 点击，看下拉
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(400)
input.focus()
input.click()
input.dispatchEvent(new MouseEvent('click', { bubbles: true }))
await sleep(1500)

const dd = dropdown()
out.下拉 = {
  存在: !!dd,
  可见: dd ? dd.offsetParent !== null : false,
  条目数: dd ? dd.querySelectorAll('[role="option"], .item, li').length : 0,
  文本: dd ? dd.innerText.replace(/\s+/g, ' ').trim().slice(0, 80) : null
}

// 4) 键盘 Esc 能关闭
if (dd) {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await sleep(600)
  out.Esc关闭 = dropdown() ? '✗ 仍在' : '✓ 已关闭'
}

return JSON.stringify(out, null, 1)
