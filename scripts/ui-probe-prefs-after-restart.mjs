/**
 * 界面偏好：重启持久化验证（task-12 第二阶段）
 *
 * 由 ui-verify-prefs.mjs 在**重启之后**注入。判据只有一条：
 * 上一次进程写下的搜索历史与空态来源，这次启动还能读到 —— 而且是原顺序。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { steps: {} }

const prefs = await window.api.prefs.get()
out.steps.readAfterRestart = prefs

const expect = {
  searchEmptySource: 'playlist',
  searchHistory: ['第一阶段乙', '第一阶段甲']
}

out.steps.expect = expect
out.steps.sourceKept = prefs.searchEmptySource === expect.searchEmptySource
out.steps.historyKept =
  JSON.stringify(prefs.searchHistory) === JSON.stringify(expect.searchHistory)
out.steps.pass = out.steps.sourceKept && out.steps.historyKept

/* 顺带确认设置页读出来的就是重启后的值（界面上没显示成默认值） */
const ride = (label) => {
  const b = [...document.querySelectorAll('.nav-item')].find(
    (x) => (x.getAttribute('aria-label') || '') === label
  )
  if (b) b.click()
}
ride('设置')
await sleep(2200)
const sel = document.querySelector('select[data-pref="searchEmptySource"]')
out.steps.selectorValueAfterRestart = sel ? sel.value : null
out.steps.selectorMatchesStored = sel ? sel.value === expect.searchEmptySource : false

// 还原成默认，别把测试状态留给用户
await window.api.prefs.set({ searchEmptySource: 'history' })
await window.api.prefs.clearSearchHistory()
out.steps.restoredToDefault = await window.api.prefs.get()

return out
