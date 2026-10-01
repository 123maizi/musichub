/** 区分：是存储只留一条，还是下拉只渲染一条？同时量下拉的位置 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

// 1) 存储：直接连加三个词
await window.api.prefs.clearSearchHistory()
for (const w of ['周杰伦', '林俊杰', '陈奕迅']) {
  await window.api.prefs.addSearchHistory(w)
  await sleep(150)
}
await sleep(500)
out.存储 = (await window.api.prefs.get()).searchHistory

// 2) UI：回搜索页，聚焦输入框看下拉渲染了几条
const rail = [...document.querySelectorAll('.rail .nav-item')].find((x) =>
  (x.querySelector('.nav-label')?.textContent ?? '').includes('搜索')
)
rail?.click()
await sleep(2000)
const input = document.querySelector('.search-box input')
input?.focus()
input?.click()
input?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
await sleep(1500)

const pop = document.querySelector('.history-pop')
const rowsEl = pop ? [...pop.querySelectorAll('.row')] : []
out.下拉 = {
  存在: !!pop,
  渲染条数: rowsEl.length,
  文本: rowsEl.map((r) => (r.querySelector('.word')?.textContent || '').trim()),
  组件内部状态: (() => {
    const h = document.querySelector('.hist-state')
    if (!h) return null
    const o = {}
    for (const a of h.attributes) o[a.name] = a.value
    return o
  })()
}

// 3) 位置：下拉该出现在输入框正下方
if (pop && input) {
  const pr = pop.getBoundingClientRect()
  const ir = input.getBoundingClientRect()
  out.位置 = {
    输入框: { left: Math.round(ir.left), top: Math.round(ir.top), bottom: Math.round(ir.bottom), width: Math.round(ir.width) },
    下拉: { left: Math.round(pr.left), top: Math.round(pr.top), width: Math.round(pr.width) },
    左对齐偏差: Math.round(pr.left - ir.left),
    顶部偏差: Math.round(pr.top - ir.bottom),
    判定: Math.abs(pr.left - ir.left) <= 4 && Math.abs(pr.top - ir.bottom) <= 4 ? '✓ 紧贴输入框正下方' : '✗ 位置不对'
  }
} else {
  out.位置 = { 说明: '下拉或输入框不存在' }
}

return JSON.stringify(out, null, 1)
