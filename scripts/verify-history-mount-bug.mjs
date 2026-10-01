/**
 * 验证那个时序 bug：**刚进入搜索页**（输入框被自动聚焦）时，历史下拉会不会出现。
 * 关键：不要先做任何会触发状态变化的操作，模拟用户最自然的使用路径。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

// 先搜一次造出历史（否则「不显示」是合理的）
const box0 = document.querySelector('.search-box input')
if (box0) {
  box0.focus()
  box0.value = ''
  box0.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(200)
  box0.value = '周杰伦'
  box0.dispatchEvent(new Event('input', { bubbles: true }))
  box0.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    if (document.querySelectorAll('.results .row').length > 0) break
  }
}

out.搜索是否真的执行 = {
  结果行数: document.querySelectorAll('.results .row').length,
  输入框当前值: box0?.value ?? '(没找到输入框)'
}

// 先确认历史里确实有内容（否则「不显示」是合理的）
let prefs = null
try {
  prefs = await window.api.prefs.get()
} catch (e) {
  out.读prefs失败 = String(e.message)
}
out.历史 = { 条数: (prefs?.searchHistory ?? []).length, 内容: (prefs?.searchHistory ?? []).slice(0, 3) }

// 离开搜索页再回来 —— 制造一次「全新挂载」，这才是用户点侧栏进来的样子
const rail = (label) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(label)
  )
rail('音源')?.click()
await sleep(1800)

// 回到搜索页，**之后什么都不做**，只等
rail('搜索')?.click()
await sleep(2500)

const input = document.querySelector('.search-box input')
out.进入后 = {
  输入框自动聚焦: document.activeElement === input ? '✓ 是（SearchView onMounted 里 focus）' : '✗ 否',
  下拉是否存在: !!document.querySelector('.history-pop'),
  下拉条目数: document.querySelector('.history-pop')
    ? document.querySelector('.history-pop').querySelectorAll('[role="option"], .item').length
    : 0
}

// 再等一会，排除「只是慢」
await sleep(2500)
out.再等2_5秒后 = {
  下拉是否存在: !!document.querySelector('.history-pop'),
  下拉条目数: document.querySelector('.history-pop')
    ? document.querySelector('.history-pop').querySelectorAll('[role="option"], .item').length
    : 0
}

// 对照：手动再点一次输入框（触发 click 路径）
input?.click()
input?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
await sleep(1500)
out.手动点击后 = {
  下拉是否存在: !!document.querySelector('.history-pop'),
  下拉条目数: document.querySelector('.history-pop')
    ? document.querySelector('.history-pop').querySelectorAll('[role="option"], .item').length
    : 0
}

out.结论 =
  out.历史.条数 > 0 && !out.进入后.下拉是否存在
    ? '★ 复现了：历史里有 ' + out.历史.条数 + ' 条，但刚进入搜索页时下拉不出现（onMounted 时序 bug）'
    : out.历史.条数 === 0
      ? '历史为空，本次无法判定'
      : '未复现'

return JSON.stringify(out, null, 1)
