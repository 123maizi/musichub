/**
 * 读历史下拉组件的内部状态（task-12 定位用，一次性）
 * 组件自带一个隐藏的 .hist-state 标记，把 internal state 摊出来。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { steps: {} }

const ride = (label) => {
  const b = [...document.querySelectorAll('.nav-item')].find(
    (x) => (x.getAttribute('aria-label') || '') === label
  )
  if (b) b.click()
}
const state = () => {
  const el = document.querySelector('.hist-state')
  if (!el) return null
  const o = {}
  for (const a of el.attributes) o[a.name] = a.value
  return o
}

await window.api.prefs.clearSearchHistory()
await window.api.prefs.addSearchHistory('周杰伦')
await window.api.prefs.addSearchHistory('陈奕迅')
out.steps.seeded = (await window.api.prefs.get()).searchHistory
out.steps.directBefore = await window.api.prefs.get()

ride('搜索')
await sleep(2200)
out.steps.stateAfterMount = state()

const input = document.querySelector('.search-box input')
input?.dispatchEvent(new Event('focus', { bubbles: true }))
await sleep(900)
out.steps.stateAfterFocus = state()
out.steps.directAtFocus = await window.api.prefs.get()

// 再补几次，看是不是时序问题（多次尝试能成功就说明是竞态而不是逻辑错）
for (let i = 1; i <= 5; i += 1) {
  if (document.querySelector('.history-pop')) break
  input?.dispatchEvent(new Event('focus', { bubbles: true }))
  input?.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(700)
  out.steps['retry' + i] = state()
}

out.steps.final = state()
out.steps.prefsNow = (await window.api.prefs.get()).searchHistory

return out
