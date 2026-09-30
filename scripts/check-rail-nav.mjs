/**
 * 逐个点左侧导航柱，看是否真的切换路由。
 * 用户报告「收藏和下载按键点击无效」—— 这里给出确定性结论。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { 起点: window.location.hash }

const btns = [...document.querySelectorAll('.rail .nav-item')]
out.导航项 = btns.map((b) => ({
  标签: b.querySelector('.nav-label')?.textContent?.trim() ?? '',
  title: b.getAttribute('title') ?? '',
  可见: b.offsetParent !== null,
  尺寸: Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height),
  被遮挡: (() => {
    const r = b.getBoundingClientRect()
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return el === b || b.contains(el) ? '否' : '是 → ' + (el?.className || el?.tagName || '?')
  })()
}))

// 逐个点击，看路由是否变化
out.点击结果 = []
for (let i = 0; i < btns.length; i += 1) {
  const b = btns[i]
  const label = b.querySelector('.nav-label')?.textContent?.trim() ?? '#' + i
  const before = window.location.hash
  b.click()
  await sleep(900)
  const after = window.location.hash
  out.点击结果.push({
    项: label,
    点击前: before,
    点击后: after,
    切换: before !== after ? '✓' : '✗ 无变化',
    视图内容长度: (document.querySelector('.page')?.innerText ?? '').trim().length
  })
  // 回到搜索页，保证下一轮起点一致
  window.location.hash = '#/search'
  await sleep(700)
}

// 再测一次：用真实鼠标坐标点击（排除 .click() 与真实点击行为不一致）
const b2 = [...document.querySelectorAll('.rail .nav-item')].find((b) =>
  (b.querySelector('.nav-label')?.textContent ?? '').includes('收藏')
)
if (b2) {
  const r = b2.getBoundingClientRect()
  const before = window.location.hash
  const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
  b2.dispatchEvent(new MouseEvent('mousedown', opts))
  b2.dispatchEvent(new MouseEvent('mouseup', opts))
  b2.dispatchEvent(new MouseEvent('click', opts))
  await sleep(900)
  out.真实坐标点击收藏 = { 点击前: before, 点击后: window.location.hash }
}

window.location.hash = '#/search'
return JSON.stringify(out, null, 1)
