/**
 * UI 板块清单（结构级，不涉及配色）。
 *
 * 目的：改版前先把「现在有哪些板块、各自多大、装什么数据、哪些能动能不动」量清楚。
 * 用真实渲染结果而不是读模板 —— 因为滚动容器、固定高度、溢出行为只有跑起来才知道。
 *
 * 用法：node scripts/cdp-run.mjs <port> scripts/ui-layout-inventory.mjs
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function describe(el) {
  if (!el) return null
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
  return {
    选择器: el.tagName.toLowerCase() + (cls ? '.' + cls : ''),
    尺寸: `${Math.round(r.width)}x${Math.round(r.height)}`,
    位置: `${Math.round(r.left)},${Math.round(r.top)}`,
    溢出: `${cs.overflowX}/${cs.overflowY}`,
    定位: cs.position,
    子元素数: el.children.length
  }
}

/** 只取「结构块」：直接子元素里尺寸占比 >3% 的，以及有明确语义的容器 */
function blocks(root) {
  if (!root) return []
  return [...root.children].map(describe).filter(Boolean)
}

const routes = ['#/search', '#/library', '#/downloads', '#/sources', '#/settings']
const out = { 外壳: {}, 各视图: {} }

out.外壳.侧边栏 = {
  容器: describe(document.querySelector('.sidebar')),
  品牌区: describe(document.querySelector('.brand')),
  导航: blocks(document.querySelector('.nav')),
  侧栏统计: blocks(document.querySelector('.side-stat'))
}
out.外壳.主区 = describe(document.querySelector('.main'))
out.外壳.播放条 = describe(document.querySelector('body > div:last-child') ?? null)

for (const route of routes) {
  location.hash = route
  await sleep(1500)
  if (route === '#/search') {
    const input = document.querySelector('.search-box input')
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '周杰伦')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(200)
      document.querySelector('.search-box button.primary')?.click()
      await sleep(7000)
    }
  }
  const view = document.querySelector('main > *')
  const viewBox = describe(view)
  const inner = []
  if (view) {
    const walk = (node, depth) => {
      if (depth > 1) return
      for (const child of node.children) {
        const d = describe(child)
        if (!d) continue
        const w = parseInt(d.尺寸.split('x')[0], 10)
        if (w > 40) inner.push({ 层级: depth, ...d })
        if (depth < 1) walk(child, depth + 1)
      }
    }
    walk(view, 0)
  }
  /* 滚动容器单独标出来：改版时最容易踩的就是「谁在滚」 */
  const scrollers = [...document.querySelectorAll('main *')]
    .filter((el) => {
      const cs = getComputedStyle(el)
      return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4
    })
    .slice(0, 4)
    .map((el) => ({
      选择器: describe(el).选择器,
      可视高: el.clientHeight,
      内容高: el.scrollHeight
    }))

  out.各视图[route] = { 根: viewBox, 板块: inner.slice(0, 14), 滚动容器: scrollers }
}

location.hash = '#/search'
await sleep(600)

/* 输出紧凑摘要：结构清单要的是「有哪些板块、多大、谁在滚」，不是整棵 DOM 树 */
const lines = []
const fmt = (d) => (d ? `${d.选择器} ${d.尺寸}` : '(未测到)')
lines.push('== 外壳 ==')
lines.push(`侧边栏        ${fmt(out.外壳.侧边栏.容器)}`)
lines.push(`  品牌区      ${fmt(out.外壳.侧边栏.品牌区)}`)
lines.push(`  导航        ${out.外壳.侧边栏.导航.length} 项，每项 ${out.外壳.侧边栏.导航[0]?.尺寸 ?? '?'}`)
lines.push(`  侧栏统计    ${out.外壳.侧边栏.侧栏统计.length} 行，容器 ${fmt(out.外壳.侧边栏.侧栏统计[0])}`)
lines.push(`主区          ${fmt(out.外壳.主区)}`)
lines.push(`播放条        ${fmt(out.外壳.播放条)}`)
lines.push('')
for (const [route, v] of Object.entries(out.各视图)) {
  lines.push(`== ${route} ==`)
  lines.push(`根            ${fmt(v.根)}`)
  lines.push(`板块(${v.板块.length})`)
  for (const b of v.板块) {
    lines.push(`  - ${'  '.repeat(b.层级)}${b.选择器}  ${b.尺寸} @${b.位置} 溢出=${b.溢出}`)
  }
  lines.push(`滚动容器      ${v.滚动容器.length ? v.滚动容器.map((s) => `${s.选择器}(${s.可视高}<${s.内容高})`).join('  ') : '无'}`)
  lines.push('')
}
return lines.join('\n')
