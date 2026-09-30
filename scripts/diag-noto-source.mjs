/** 揪出 "Noto Sans SC" 到底是哪个元素（审计口径：computed fontFamily 的首个族名） */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const scan = (label) => {
  const hits = []
  const all = new Map()
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    const first = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim()
    all.set(first, (all.get(first) ?? 0) + 1)
    if (/Noto/i.test(cs.fontFamily || '')) {
      if (hits.length < 8) {
        const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
        hits.push({
          tag: el.tagName.toLowerCase() + cls,
          family: cs.fontFamily.slice(0, 80),
          visible: !!el.offsetParent,
          type: el.getAttribute('type') ?? null
        })
      }
    }
  }
  return { label, families: [...all.entries()].sort((a, b) => b[1] - a[1]), notoHits: hits }
}

const out = {}
window.location.hash = '#/search'
await sleep(1200)
out.search = scan('#/search')
window.location.hash = '#/settings'
await sleep(1000)
out.settings = scan('#/settings')
return out
