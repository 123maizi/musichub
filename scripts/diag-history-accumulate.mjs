/** 真实走 UI 连搜三个不同词，看存储里是 1 条还是 3 条 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { 每次搜索后: [] }

await window.api.prefs.clearSearchHistory()

const rail = [...document.querySelectorAll('.rail .nav-item')].find((x) =>
  (x.querySelector('.nav-label')?.textContent ?? '').includes('搜索')
)
rail?.click()
await sleep(2000)

const input = document.querySelector('.search-box input')
if (!input) return JSON.stringify({ 错误: '没找到搜索框' })

for (const w of ['周杰伦', '林俊杰', '陈奕迅']) {
  input.focus()
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(250)
  input.value = w
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(250)
  // 真实按键：keydown + keyup（SearchView 用 @keyup.enter）
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 15; i += 1) {
    await sleep(700)
    if (document.querySelectorAll('.results .row').length > 0) break
  }
  await sleep(800)
  const hist = (await window.api.prefs.get()).searchHistory
  out.每次搜索后.push({ 搜的词: w, 结果行数: document.querySelectorAll('.results .row').length, 历史: hist })
}

out.最终历史 = (await window.api.prefs.get()).searchHistory
out.判定 =
  out.最终历史.length >= 3
    ? '✓ 能累计多条'
    : out.最终历史.length === 1
      ? '★ 复现：只留 1 条（最后搜的那个），说明每次写入把它替换掉了'
      : `只留 ${out.最终历史.length} 条`

return JSON.stringify(out, null, 1)
