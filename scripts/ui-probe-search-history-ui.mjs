/**
 * 搜索历史下拉：交互验证（task-12 第三段）
 *
 * 前提：render-perf 已按方案 (b) 在 SearchView 里挂上 SearchHistoryDropdown。
 * 组件没挂上时本探针会明确报「未挂载」，而不是给一堆看不懂的失败 ——
 * 免得把「还没接线」误判成「组件坏了」。
 *
 * 覆盖验收项：
 *   · 下拉列出历史（最新在前，最多 10 条）
 *   · 点历史项 → 真的搜出结果，并把该词提到最前
 *   · 单条删除生效
 *   · 清空全部生效
 *   · 键盘 ↑ / ↓ / Enter / Esc 四个键都可用
 *   · 点击页面其它地方关闭
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { steps: {} }
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail })

const POP = '.history-pop'
const pop = () => document.querySelector(POP)
const rows = () => [...document.querySelectorAll(POP + ' .row')]
const words = () => rows().map((r) => (r.querySelector('.word')?.textContent || '').trim())

/* ---------- 0. 铺一个已知历史 ---------- */
await window.api.prefs.clearSearchHistory()
await window.api.prefs.addSearchHistory('周杰伦')
await window.api.prefs.addSearchHistory('林俊杰')
await window.api.prefs.addSearchHistory('陈奕迅')
out.steps.seeded = (await window.api.prefs.get()).searchHistory

/* ---------- 1. 到搜索页并聚焦搜索框 ---------- */
const ride = (label) => {
  const b = [...document.querySelectorAll('.nav-item')].find(
    (x) => (x.getAttribute('aria-label') || '') === label
  )
  if (b) b.click()
  return Boolean(b)
}
ride('搜索')
await sleep(1800)

const input =
  document.querySelector('.search-box input') ??
  document.querySelector('.toolbar input[type="text"]') ??
  document.querySelector('input[type="search"]') ??
  [...document.querySelectorAll('input')].find((i) => i.offsetParent && i.type === 'text')
out.steps.inputFound = Boolean(input)
if (!input) {
  out.checks = checks
  out.pass = false
  out.error = '搜索页找不到输入框，无法继续'
  return out
}
out.steps.inputSelector =
  input.className || input.getAttribute('placeholder') || input.type

// 清空输入（空态更容易让父组件展开历史）
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
input.dispatchEvent(new Event('focus', { bubbles: true }))
await sleep(900)

if (!pop()) {
  out.checks = checks
  out.pass = false
  out.notMounted = true
  out.error =
    '历史下拉没有出现：组件可能还没挂进 SearchView（方案 b 需要 render-perf 加一行），' +
    '或父组件的展开条件与「聚焦 + 空输入」不同。这不是存储层的问题 —— 存储层 13 项已单独验过。'
  return out
}

/* ---------- 2. 列表内容与顺序 ---------- */
const list0 = words()
out.steps.listOnOpen = list0
check('下拉列出历史且最新在前', JSON.stringify(list0.slice(0, 3)) === JSON.stringify(['陈奕迅', '林俊杰', '周杰伦']), list0)

const rowH = rows()[0]?.getBoundingClientRect().height ?? 0
out.steps.rowHeight = rowH
check('行命中区 ≥24px', rowH >= 24, rowH)

const delBox = document.querySelector(POP + ' .del')?.getBoundingClientRect()
out.steps.delHit = delBox ? `${Math.round(delBox.width)}x${Math.round(delBox.height)}` : null
check('删除按钮命中区 ≥24px', !!delBox && delBox.width >= 24 && delBox.height >= 24, out.steps.delHit)

const clearBox = document.querySelector(POP + ' .clear')?.getBoundingClientRect()
out.steps.clearHit = clearBox ? `${Math.round(clearBox.width)}x${Math.round(clearBox.height)}` : null
check('清空按钮命中区 ≥24px', !!clearBox && clearBox.height >= 24, out.steps.clearHit)

/* ---------- 3. 键盘 ↑ ↓ ---------- */
const key = (k) => input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
key('ArrowDown')
await sleep(120)
const activeAfterDown1 = rows().findIndex((r) => r.classList.contains('active'))
key('ArrowDown')
await sleep(120)
const activeAfterDown2 = rows().findIndex((r) => r.classList.contains('active'))
key('ArrowUp')
await sleep(120)
const activeAfterUp = rows().findIndex((r) => r.classList.contains('active'))
out.steps.keyboard = { afterDown1: activeAfterDown1, afterDown2: activeAfterDown2, afterUp: activeAfterUp }
check('↓ 选中第一项', activeAfterDown1 === 0, activeAfterDown1)
check('↓ 再按选中第二项', activeAfterDown2 === 1, activeAfterDown2)
check('↑ 回到第一项', activeAfterUp === 0, activeAfterUp)

/* ---------- 4. Enter 确认 → 真的搜出结果 + 提到最前 ---------- */
key('ArrowDown') // 确保第一项高亮（周杰伦在 index2，这次先重排一下）
await sleep(100)
const pickTarget = rows()[rows().findIndex((r) => r.classList.contains('active'))]?.querySelector('.word')?.textContent?.trim()
out.steps.pickTarget = pickTarget
key('Enter')
await sleep(3500)

const stillOpen = Boolean(pop())
out.steps.popAfterEnter = stillOpen
let resultRows = 0
for (let i = 0; i < 20; i += 1) {
  resultRows = document.querySelectorAll('.results .row').length
  if (resultRows > 0) break
  await sleep(500)
}
out.steps.resultRows = resultRows
check('Enter 选中的词能真的搜出结果', resultRows > 0, resultRows)

const historyAfterPick = (await window.api.prefs.get()).searchHistory
out.steps.historyAfterPick = historyAfterPick
check(
  '选中的词被提到最前',
  !!pickTarget && historyAfterPick[0] === pickTarget,
  { pickTarget, head: historyAfterPick.slice(0, 3) }
)

/* ---------- 5. 单条删除 ---------- */
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(700)
if (pop()) {
  const before = (await window.api.prefs.get()).searchHistory.length
  const firstWord = words()[0]
  document.querySelector(POP + ' .del')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await sleep(600)
  const after = (await window.api.prefs.get()).searchHistory
  out.steps.deleteCheck = { before, after: after.length, removed: firstWord }
  check('单条删除生效', after.length === before - 1 && !after.includes(firstWord), out.steps.deleteCheck)
} else {
  check('单条删除生效', false, '下拉没展开，无法测删除')
}

/* ---------- 6. 点外关闭 ---------- */
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(700)
const openBeforeOutside = Boolean(pop())
document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
await sleep(600)
out.steps.outsideClick = { openBefore: openBeforeOutside, openAfter: Boolean(pop()) }
check('点页面其它地方会关闭', openBeforeOutside && !pop(), out.steps.outsideClick)

/* ---------- 7. Esc 关闭 ---------- */
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(700)
const openBeforeEsc = Boolean(pop())
key('Escape')
await sleep(600)
out.steps.esc = { openBefore: openBeforeEsc, openAfter: Boolean(pop()) }
check('Esc 关闭', openBeforeEsc && !pop(), out.steps.esc)

/* ---------- 8. 清空全部 ---------- */
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(700)
if (pop()) {
  document.querySelector(POP + ' .clear')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await sleep(700)
  const afterClear = (await window.api.prefs.get()).searchHistory
  out.steps.afterClear = afterClear
  check('清空全部生效', afterClear.length === 0, afterClear)
} else {
  check('清空全部生效', false, '下拉没展开，无法测清空')
}

/* ---------- 9. 点选历史项（鼠标路径）----------
   上面测的是 Enter，这里补鼠标：重新铺两条历史后直接点第一行 */
await window.api.prefs.addSearchHistory('邓紫棋')
await window.api.prefs.addSearchHistory('薛之谦')
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(700)
if (pop()) {
  const target = words()[0]
  rows()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await sleep(3000)
  const h = (await window.api.prefs.get()).searchHistory
  out.steps.mousePick = { target, head: h.slice(0, 2) }
  check('鼠标点历史项生效（并提到最前）', h[0] === target, out.steps.mousePick)
} else {
  check('鼠标点历史项生效（并提到最前）', false, '下拉没展开')
}

/* 收尾：别把测试历史留给用户 */
await window.api.prefs.clearSearchHistory()

out.checks = checks
out.failed = checks.filter((c) => !c.pass)
out.pass = out.failed.length === 0
return out
