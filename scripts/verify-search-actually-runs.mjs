/**
 * 决定性检查：我的合成输入到底有没有触发一次真实搜索？
 * 用一个必然搜不到的怪词 —— 结果行数若不变，说明搜索没跑，前面的「没写入历史」是探针假象。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const rows = () => document.querySelectorAll('.results .row').length
const hist = async () => (await window.api.prefs.get()).searchHistory ?? []

// 先确保有结果（正常搜索一次）
const input = document.querySelector('.search-box input')
if (!input) return JSON.stringify({ 错误: '没找到搜索框' })

input.focus()
input.value = '周杰伦'
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(300)
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
for (let i = 0; i < 20; i += 1) {
  await sleep(1000)
  if (rows() > 0) break
}
out.先正常搜一次 = { 行数: rows(), 历史条数: (await hist()).length }

// 再搜一个必然没有的怪词
const beforeRows = rows()
const beforeHist = (await hist()).length
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(300)
input.value = 'zzz不存在的词qqq'
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(300)
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
await sleep(6000)

out.怪词搜索 = {
  搜索前行数: beforeRows,
  搜索后行数: rows(),
  行数变化: beforeRows !== rows() ? '✓ 变了 → 搜索确实执行了' : '✗ 没变 → 搜索没执行',
  搜索前历史: beforeHist,
  搜索后历史: (await hist()).length
}

// 收尾：清掉怪词，别留在历史里
try {
  for (const w of (await hist()).filter((x) => String(x).includes('zzz不存在'))) {
    await window.api.prefs.removeSearchHistory?.(w)
  }
  out.已清理 = true
} catch {
  out.已清理 = false
}

return JSON.stringify(out, null, 1)
