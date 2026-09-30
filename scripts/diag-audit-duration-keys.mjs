/**
 * 复现审计的「时长种类」计数口径，把 6 个 key 原样打出来 + 每个 key 的元素样例。
 * 审计口径（design-audit.mjs:313-327）：key = getComputedStyle().transitionDuration 整串，
 * 于是「1 个属性」和「4 个属性」即使值相同也会被算成两个不同的 key。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const keyMap = new Map()
for (const el of document.querySelectorAll('*')) {
  const cs = getComputedStyle(el)
  if (!el.offsetParent && cs.position !== 'fixed') continue
  const prop = cs.transitionProperty
  const dur = cs.transitionDuration
  const hasTransition = prop && prop !== 'none' && dur && !/^0s(, 0s)*$/.test(dur)
  const hasAnimation = cs.animationName && cs.animationName !== 'none'
  const add = (key, kind, extra) => {
    const e = keyMap.get(key) ?? { key, kind, count: 0, samples: [] }
    e.count += 1
    if (e.samples.length < 3) {
      const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''
      e.samples.push(el.tagName.toLowerCase() + cls + (extra ? ` [${extra}]` : ''))
    }
    keyMap.set(key, e)
  }
  if (hasTransition) add(dur, 'transition', prop)
  if (hasAnimation) add(cs.animationDuration, 'animation', cs.animationName)
}
const rows = [...keyMap.values()].sort((a, b) => b.count - a.count)
const distinctValues = [...new Set(rows.flatMap((r) => r.key.split(',').map((s) => s.trim())))].sort()
return {
  keyCount: rows.length,
  distinctValueCount: distinctValues.length,
  keys: rows.map((r) => ({ key: r.key, kind: r.kind, count: r.count, samples: r.samples })),
  distinctValues,
  rowsSampled: document.querySelectorAll('*').length
}
