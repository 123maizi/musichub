/** 现在这一刻，点「我的」和「下载」到底会不会换页 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ident = () => {
  const p = document.querySelector('.page')
  const first = p?.firstElementChild
  return (first?.className || first?.tagName || '空').toString().slice(0, 40)
}
const out = {
  窗口: { hidden: document.hidden, visibility: document.visibilityState },
  rAF可用: await new Promise((res) => {
    let n = 0
    const t0 = performance.now()
    const tick = () => {
      n++
      if (performance.now() - t0 < 500) requestAnimationFrame(tick)
      else res(n)
    }
    requestAnimationFrame(tick)
    setTimeout(() => res(n), 700)
  }),
  初始: { hash: location.hash, 视图: ident() }
}

const click = async (label) => {
  const btns = [...document.querySelectorAll('.rail .nav-item')]
  const b = btns.find((x) => (x.querySelector('.nav-label')?.textContent ?? '').includes(label))
  if (!b) return { 找不到: label, 现有: btns.map((x) => x.querySelector('.nav-label')?.textContent) }
  const r = b.getBoundingClientRect()
  const hitEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  b.click()
  await sleep(2000)
  return {
    点击目标: label,
    命中点元素: hitEl?.tagName + '.' + (hitEl?.className || ''),
    命中点就是按钮: hitEl === b || b.contains(hitEl) ? '✓' : '✗ 被遮挡',
    hash: location.hash,
    视图: ident(),
    残留leave: document.querySelectorAll('.route-leave-active').length,
    顶栏标题: (document.querySelector('.topbar h1, header h1')?.textContent ?? '').trim(),
    页面文本前60: (document.querySelector('.page')?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  }
}

out.点我的 = await click('我的')
out.点下载 = await click('下载')
out.点搜索 = await click('搜索')

return JSON.stringify(out, null, 1)
