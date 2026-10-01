/**
 * 界面偏好 + 搜索历史：存储层与设置页选择器验证（task-12 第一阶段）
 *
 * 覆盖验收项：
 *   · 连续记 3 个词 → 顺序正确（最新在前）
 *   · 重复词不产生重复项（且会提到最前）
 *   · 忽略大小写/空白去重
 *   · 50 次之后仍只有 20 条
 *   · 删除单条 / 清空全部生效
 *   · 设置页选择器切换后**立即生效**（读回配置确认）
 *
 * 「重启后仍在」由 ui-verify-prefs.mjs 用同一个 profile 重启第二次来验；
 * 「下拉 UI / 键盘」由 ui-probe-search-history-ui.mjs 在组件挂进 SearchView 后验。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { steps: {} }
const prefs = () => window.api.prefs

/** 断言收集：每条都留证据，失败不打断后续（一次跑完看到全貌） */
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail })

/* ---------- 0. 清场：从空历史开始 ---------- */
await prefs().clearSearchHistory()
await prefs().set({ searchEmptySource: 'history' })
out.steps.cleared = await prefs().get()

/* ---------- 1. 连续记 3 个词 → 最新在前 ---------- */
await prefs().addSearchHistory('周杰伦')
await prefs().addSearchHistory('林俊杰')
await prefs().addSearchHistory('陈奕迅')
let h = (await prefs().get()).searchHistory
check('连续 3 词顺序正确（最新在前）', JSON.stringify(h) === JSON.stringify(['陈奕迅', '林俊杰', '周杰伦']), h)

/* ---------- 2. 重复词：不新增，且提到最前 ---------- */
await prefs().addSearchHistory('周杰伦')
h = (await prefs().get()).searchHistory
check(
  '重复词不产生重复项且提到最前',
  h.length === 3 && h[0] === '周杰伦' && new Set(h).size === 3,
  h
)

/* ---------- 3. 大小写 / 多余空白去重，保留最新写法 ---------- */
await prefs().addSearchHistory('  Adele  ')
await prefs().addSearchHistory('ADELE')
h = (await prefs().get()).searchHistory
check(
  '忽略大小写与空白去重（保留最新写法）',
  h.filter((w) => w.toLowerCase() === 'adele').length === 1 && h[0] === 'ADELE',
  h
)

/* ---------- 4. 空串被忽略 ---------- */
const beforeEmpty = (await prefs().get()).searchHistory.length
await prefs().addSearchHistory('   ')
h = (await prefs().get()).searchHistory
check('空白关键词不写入', h.length === beforeEmpty, { before: beforeEmpty, after: h.length })

/* ---------- 5. 50 次之后仍只有 20 条，且最新的在最前 ---------- */
for (let i = 1; i <= 50; i += 1) await prefs().addSearchHistory('测试词' + i)
h = (await prefs().get()).searchHistory
check('50 次搜索后仍只有 20 条', h.length === 20, h.length)
check('截断后保留的是最新 20 条', h[0] === '测试词50' && h[19] === '测试词31', [h[0], h[19]])
check('截断后无重复', new Set(h).size === 20, new Set(h).size)

/* ---------- 6. 删除单条 ---------- */
await prefs().removeSearchHistory('测试词50')
h = (await prefs().get()).searchHistory
check('删除单条生效', h.length === 19 && !h.includes('测试词50'), h.slice(0, 3))

/* ---------- 7. 清空全部 ---------- */
await prefs().clearSearchHistory()
h = (await prefs().get()).searchHistory
check('清空全部生效', h.length === 0, h)

/* ---------- 8. 设置页选择器：切换后立即生效 ---------- */
const ride = (label) => {
  const b = [...document.querySelectorAll('.nav-item')].find(
    (x) => (x.getAttribute('aria-label') || '') === label
  )
  if (b) b.click()
  return Boolean(b)
}
ride('设置')
await sleep(2000)

const sel = document.querySelector('select[data-pref="searchEmptySource"]')
out.steps.selectorFound = Boolean(sel)
if (sel) {
  const options = [...sel.options].map((o) => o.value)
  out.steps.selectorOptions = options
  check('选择器有三个选项且顺序为 历史/喜欢/歌单', JSON.stringify(options) === JSON.stringify(['history', 'favorites', 'playlist']), options)
  check('选择器初值为 history', sel.value === 'history', sel.value)

  // 真实交互：改 value 后派发 change（与用户选择等价）
  sel.value = 'favorites'
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(300)
  const now = await prefs().get()
  check('切换后立即生效（300ms 内读回已变）', now.searchEmptySource === 'favorites', now.searchEmptySource)

  // 再切到 playlist，并**故意留着不还原**，交给宿主机核对落盘
  sel.value = 'playlist'
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(300)
  const now2 = await prefs().get()
  check('再切换到 playlist 立即生效', now2.searchEmptySource === 'playlist', now2.searchEmptySource)
}

/* ---------- 9. 留一个已知状态给宿主机核对磁盘 + 给第二阶段核对重启 ---------- */
await prefs().clearSearchHistory()
await prefs().addSearchHistory('第一阶段甲')
await prefs().addSearchHistory('第一阶段乙')
out.steps.leavedState = await prefs().get()
out.steps.leavedFor = {
  expectOnDisk: { searchEmptySource: 'playlist', searchHistory: ['第一阶段乙', '第一阶段甲'] },
  note: '宿主机在本进程存活时读 ui-prefs.json 核对防抖是否已落盘；第二阶段重启后核对历史仍在'
}

out.checks = checks
out.failed = checks.filter((c) => !c.pass)
out.pass = out.failed.length === 0
return out
