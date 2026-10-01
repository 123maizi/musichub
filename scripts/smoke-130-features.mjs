/** 冒烟：确认两个新功能在**打包后的构建**里真的能用 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

// 1) 搜索页空态推荐列表
const rail = (label) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(label)
  )
rail('搜索')?.click()
await sleep(2500)
// 清空搜索框让它回到空态
const input = document.querySelector('.search-box input')
if (input) {
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
await sleep(2500)

out.空态 = {
  搜索结果行数: document.querySelectorAll('.results .row').length,
  全页文本片段: (document.querySelector('.page')?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
  找到推荐列表: (() => {
    const secs = [...document.querySelectorAll('.page *')]
    const t = secs.find((el) => /继续听|我喜欢的|歌单里的歌/.test(el.textContent ?? '') && el.children.length < 40)
    return t ? t.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : '没找到标题'
  })(),
  推荐区行数: (() => {
    // 推荐区里的行通常带 data-song-id 或同为 .row 结构；先看是否有第二个表格
    const tables = [...document.querySelectorAll('.page table, .page .songs')]
    return tables.map((t) => t.querySelectorAll('.row, tr').length)
  })()
}

// 2) 历史搜索下拉
if (input) {
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(300)
  input.focus()
  input.click()
  input.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await sleep(1200)
}
out.历史下拉 = {
  聚焦元素: document.activeElement?.tagName + '.' + (document.activeElement?.className || ''),
  下拉存在: !!document.querySelector('[class*="history" i], [class*="dropdown" i]'),
  下拉可见元素: [...document.querySelectorAll('[class*="history" i] *')]
    .filter((el) => el.offsetParent !== null)
    .slice(0, 6)
    .map((el) => (el.innerText || '').trim().slice(0, 20))
    .filter(Boolean)
}
out.历史存储 = await (async () => {
  try {
    const p = await window.api.prefs.get()
    return { 有prefs接口: true, searchEmptySource: p?.searchEmptySource, 历史条数: (p?.searchHistory ?? []).length }
  } catch (e) {
    return { 有prefs接口: false, 错误: String(e.message).slice(0, 60) }
  }
})()

return JSON.stringify(out, null, 1)
