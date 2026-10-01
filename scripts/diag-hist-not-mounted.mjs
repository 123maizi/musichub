/** 查清为什么 9222 上 .hist-state 不存在（组件没挂载） */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

const rail = (label) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(label)
  )

// 确保在搜索页
rail('搜索')?.click()
await sleep(2500)

out.环境 = { hidden: document.hidden, visibility: document.visibilityState }
out.当前路由 = location.hash
out.挂载情况 = {
  histState标记: document.querySelectorAll('.hist-state').length,
  historyPop: document.querySelectorAll('.history-pop').length,
  searchInput: document.querySelectorAll('.search-box input').length,
  view数: document.querySelectorAll('.view').length
}

// 载入的 chunk 名（对比构建）
out.入口 = [...document.querySelectorAll('script[src]')].map((s) => s.src.split('/').pop()).join(',')

// 搜索框的父级链路，看下拉该挂在哪儿
const input = document.querySelector('.search-box input')
out.搜索框结构 = (() => {
  if (!input) return null
  let el = input
  const chain = []
  for (let i = 0; i < 5 && el; i += 1) {
    chain.push(el.tagName + '.' + (typeof el.className === 'string' ? el.className : ''))
    el = el.parentElement
  }
  return chain
})()

// SearchView 的模板里下拉是不是被 v-if 挡着 —— 看父容器有没有占位
out.搜索框同级元素 = (() => {
  const box = document.querySelector('.search-box')
  if (!box) return null
  const parent = box.parentElement
  return parent ? [...parent.children].map((c) => c.tagName + '.' + (typeof c.className === 'string' ? c.className : '')) : null
})()

return JSON.stringify(out, null, 1)
