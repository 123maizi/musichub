/** 对比「回车」与「点按钮」两条路径，看历史写入是否只在其中一条生效 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const hist = async () => (await window.api.prefs.get()).searchHistory ?? []

const input = document.querySelector('.search-box input')

const typeFresh = async (word) => {
  input.focus()
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(300)
  input.value = word
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(300)
  return (await window.api.prefs.get()).search?.keyword ?? null
}

// A. 回车路径
const beforeA = await hist()
const kwA = await typeFresh('回车路径_C')
input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
await sleep(3500)
const afterA = await hist()
out.回车路径 = {
  输入后store关键词: kwA,
  前: beforeA.length,
  后: afterA.length,
  首条: afterA[0] ?? null,
  写入: afterA.length > beforeA.length ? '✓' : '✗'
}

// B. 点按钮路径
const beforeB = await hist()
await typeFresh('按钮路径_D')
const btns = [...document.querySelectorAll('button')]
const searchBtn = btns.find((b) => /搜索/.test((b.innerText || '') + (b.title || '')) && b.offsetParent !== null)
out.搜索按钮 = searchBtn ? (searchBtn.innerText || searchBtn.title || '').trim().slice(0, 10) : '没找到'
searchBtn?.click()
await sleep(3500)
const afterB = await hist()
out.按钮路径 = {
  前: beforeB.length,
  后: afterB.length,
  首条: afterB[0] ?? null,
  写入: afterB.length > beforeB.length ? '✓' : '✗'
}

// C. 当前 store 关键词 vs 输入框（判断按钮是否真读了输入框）
out.状态 = {
  输入框值: input.value,
  store关键词: (await window.api.prefs.get()).search?.keyword ?? '(取不到)'
}

out.最终历史 = (await hist()).slice(0, 6)

// 清理探针写入的词
try {
  for (const w of (await hist()).filter((x) => /_C$|_D$/.test(String(x)))) {
    await window.api.prefs.removeSearchHistory?.(w)
  }
  out.已清理 = true
} catch {
  out.已清理 = false
}

return JSON.stringify(out, null, 1)
