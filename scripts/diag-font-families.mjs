/** 找出「字体族 3 种」和 Noto Sans SC 到底来自哪些元素（审计口径：fontFamily.split(',')[0]） */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const scan = () => {
  const map = new Map()
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (!el.offsetParent && cs.position !== 'fixed') continue
    const first = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim()
    if (!first) continue
    const key = first
    const e = map.get(key) ?? { count: 0, samples: [] }
    e.count += 1
    if (e.samples.length < 3) {
      const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
      e.samples.push(el.tagName.toLowerCase() + cls)
    }
    map.set(key, e)
  }
  return [...map.entries()].map(([family, v]) => ({ family, count: v.count, samples: v.samples })).sort((a, b) => b.count - a.count)
}
const routes = ['#/search', '#/library', '#/downloads', '#/settings', '#/sources']
const perRoute = {}
for (const r of routes) {
  window.location.hash = r
  await sleep(900)
  perRoute[r] = scan()
}
out.perRoute = perRoute
const all = new Map()
for (const list of Object.values(perRoute)) for (const x of list) all.set(x.family, (all.get(x.family) ?? 0) + x.count)
out.union = [...all.entries()].map(([family, count]) => ({ family, count })).sort((a, b) => b.count - a.count)
return out
