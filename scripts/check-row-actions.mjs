/** 测歌曲行里的「收藏到我的喜欢」和「下载为」这两个按钮到底灵不灵 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { 窗口可见: !document.hidden }

// 到搜索页
const rail = [...document.querySelectorAll('.rail .nav-item')].find((x) =>
  (x.querySelector('.nav-label')?.textContent ?? '').includes('搜索')
)
rail?.click()
await sleep(2500)

const rows0 = [...document.querySelectorAll('.results .row')]
out.点搜索后行数 = rows0.length
if (!rows0.length) {
  // 结果空了就自己搜一次（点已在当前页的导航项会把结果清掉，先不纠结）
  await new Promise((r) => setTimeout(r, 500))
  const input = document.querySelector('.search-box input')
  if (input) {
    input.focus()
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
    input.value = '周杰伦'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  }
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    if (document.querySelectorAll('.results .row').length > 0) break
  }
}

const rows = [...document.querySelectorAll('.results .row')]
out.行数 = rows.length
if (!rows.length) return JSON.stringify(out, null, 1)

const favBtn = rows[0].querySelector('.col-actions button[title*="收藏"]')
const dlBtn = rows[0].querySelector('.col-actions button[title^="下载为"]')
out.按钮 = {
  收藏: favBtn ? favBtn.getAttribute('title') : '没找到',
  下载: dlBtn ? dlBtn.getAttribute('title') : '没找到'
}

// --- 收藏 ---
const favBefore = (await window.api.library.stats()).favorites
if (favBtn) {
  const r = favBtn.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  favBtn.click()
  await sleep(1500)
  const favAfter = (await window.api.library.stats()).favorites
  out.收藏测试 = {
    点击前: favBefore,
    点击后: favAfter,
    结果: favAfter !== favBefore ? '✓ 生效' : '✗ 无变化（点不动）',
    命中点: hit?.tagName + '.' + (hit?.className || ''),
    命中就是按钮: hit === favBtn || favBtn.contains(hit) ? '✓' : '✗ 被遮挡 → ' + (hit?.className || '')
  }
} else {
  out.收藏测试 = { 结果: '没找到收藏按钮' }
}

// --- 下载 ---
const dlBefore = (await window.api.download.list()).length
if (dlBtn) {
  const r = dlBtn.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  dlBtn.click()
  await sleep(3000)
  const list = await window.api.download.list()
  out.下载测试 = {
    点击前任务数: dlBefore,
    点击后任务数: list.length,
    结果: list.length > dlBefore ? '✓ 入队' : '✗ 未入队（点不动）',
    命中点: hit?.tagName + '.' + (hit?.className || ''),
    命中就是按钮: hit === dlBtn || dlBtn.contains(hit) ? '✓' : '✗ 被遮挡 → ' + (hit?.className || ''),
    按钮尺寸: Math.round(r.width) + 'x' + Math.round(r.height)
  }
} else {
  out.下载测试 = { 结果: '没找到下载按钮' }
}

return JSON.stringify(out, null, 1)
