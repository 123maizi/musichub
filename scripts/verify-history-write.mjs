/** 直接测历史写入的 IPC 与「真正点搜索按钮」这条路径 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

// 1) IPC 本身通不通
try {
  const before = (await window.api.prefs.get()).searchHistory ?? []
  await window.api.prefs.addSearchHistory('探针测试词_A')
  await sleep(600)
  const after = (await window.api.prefs.get()).searchHistory ?? []
  out.IPC直测 = {
    调用前: before.length,
    调用后: after.length,
    首条: after[0] ?? null,
    结论: after.length > before.length ? '✓ IPC 正常' : '✗ IPC 没写进去'
  }
} catch (e) {
  out.IPC直测 = { 结论: '✗ 抛错', 错误: String(e.message).slice(0, 100) }
}

// 2) 真实走 UI：填词 + 点「搜索」按钮（比合成 keyup 更接近用户）
const input = document.querySelector('.search-box input')
const before2 = (await window.api.prefs.get()).searchHistory ?? []
if (input) {
  input.focus()
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(250)
  input.value = 'UI路径测试词_B'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(250)
  const btn = [...document.querySelectorAll('.search-box button, button')].find((b) =>
    /搜索/.test((b.innerText || '') + (b.title || ''))
  )
  out.找到搜索按钮 = btn ? (btn.innerText || btn.title || '').trim().slice(0, 12) : '没找到'
  btn?.click()
  await sleep(3000)
}
const after2 = (await window.api.prefs.get()).searchHistory ?? []
out.UI路径 = { 调用前条数: before2.length, 调用后条数: after2.length, 首条: after2[0] ?? null }
out.最终历史 = after2.slice(0, 5)

// 收尾：把探针写进去的词删掉，别污染用户的历史
try {
  for (const w of after2.filter((x) => String(x).includes('探针测试词') || String(x).includes('UI路径测试词'))) {
    await window.api.prefs.removeSearchHistory?.(w)
  }
  out.已清理探针词 = true
} catch (e) {
  out.已清理探针词 = '失败: ' + String(e.message).slice(0, 60)
}

return JSON.stringify(out, null, 1)
