/**
 * 历史下拉「为什么没出现」定位（task-12，一次性）
 *
 * 要分清三件事，它们看起来一样但责任完全不同：
 *   A. 组件没进 DOM（父组件没挂 / 被 v-if 挡住）
 *   B. 组件挂了但 visible=false（父组件的展开条件没触发）
 *   C. visible=true 但组件内部 open=false（我这边：历史没加载到 / 过滤后为空）
 *
 * 判据：
 *   · 页面里有没有 `history-pop` 这个类
 *   · Vue 在「v-if 为假」的位置会留 `<!--v-if-->` 注释；组件占位也有注释
 *   · 直接问 preload 拿历史，确认不是「数据没有」
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { steps: {} }

const ride = (label) => {
  const b = [...document.querySelectorAll('.nav-item')].find(
    (x) => (x.getAttribute('aria-label') || '') === label
  )
  if (b) b.click()
  return Boolean(b)
}

// 铺数据
await window.api.prefs.clearSearchHistory()
await window.api.prefs.addSearchHistory('周杰伦')
await window.api.prefs.addSearchHistory('陈奕迅')
out.steps.seededHistory = (await window.api.prefs.get()).searchHistory

ride('搜索')
await sleep(2200)

const input =
  document.querySelector('.search-box input') ??
  [...document.querySelectorAll('input')].find((i) => i.offsetParent)
out.steps.input = input
  ? { placeholder: input.getAttribute('placeholder'), value: input.value, focused: document.activeElement === input }
  : null

/** 把「组件相关」的痕迹都捞出来：类名、注释占位、父节点结构 */
function scene(tag) {
  const pop = document.querySelector('.history-pop')
  const parent = input?.parentElement ?? null
  return {
    tag,
    activeElement: document.activeElement ? document.activeElement.tagName + '.' + String(document.activeElement.className).slice(0, 20) : null,
    hasPop: Boolean(pop),
    popRows: pop ? pop.querySelectorAll('.row').length : 0,
    popText: pop ? (pop.innerText || '').replace(/\s+/g, ' ').slice(0, 90) : null,
    // 输入框所在容器里有没有 v-if 的占位注释（说明「条件为假」）
    inputParentHtml: parent ? String(parent.innerHTML).replace(/\s+/g, ' ').slice(0, 260) : null,
    bodyHasHistoryWord: (document.body.innerHTML || '').includes('history-pop'),
    bodyHasVIfComment: (document.body.innerHTML || '').includes('<!--v-if-->')
  }
}

out.steps.initial = scene('刚进搜索页')

// 依次单发三种触发，分别看结果，能定位是哪一种没生效
input?.dispatchEvent(new Event('focus', { bubbles: true }))
await sleep(600)
out.steps.afterFocus = scene('派发 focus 之后')

input?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
await sleep(600)
out.steps.afterClick = scene('派发 click 之后')

if (input) {
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
await sleep(800)
out.steps.afterInput = scene('派发 input 之后')

// 真实键盘：有些实现只挂 keydown，不看 focus
input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
await sleep(500)
out.steps.afterArrowDown = scene('派发 ArrowDown 之后')

// 最后再确认一次数据侧不是空的
out.steps.prefsNow = await window.api.prefs.get()

return out
