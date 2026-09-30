/**
 * 封面覆盖率对照：懒加载下「立刻测」vs「滚完整个列表再测」。
 * 结论用途：别把 loading="lazy" 造成的「还没轮到加载」误判成「封面加载不出来」。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $$ = (s) => [...document.querySelectorAll(s)]
const $ = (s) => document.querySelector(s)
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const out = {}

async function waitFor(fn, timeout = 20000, interval = 150) {
  const t0 = Date.now()
  for (;;) {
    let v
    try {
      v = await fn()
    } catch {
      v = null
    }
    if (v) return v
    if (Date.now() - t0 > timeout) return null
    await sleep(interval)
  }
}

function coverage() {
  const imgs = $$('.results .row img')
  const ok = imgs.filter((i) => i.naturalWidth > 0).length
  return {
    imgEls: imgs.length,
    loaded: ok,
    pct: imgs.length ? Number(((ok / imgs.length) * 100).toFixed(1)) : null,
    loadingAttr: imgs[0]?.getAttribute('loading') ?? null,
    rows: $$('.results .row').length
  }
}

window.location.hash = '#/search'
await sleep(900)
const search = store('search')
if (search.activePlatform !== 'all') {
  $$('.tabs .tab').find((b) => b.innerText.includes('全部'))?.click()
  await sleep(500)
}
if (search.visibleSongs.length === 0) {
  const input = $('.search-box input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '周杰伦')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(150)
  $$('.search-box button').find((b) => b.innerText.includes('搜索'))?.click()
}
await waitFor(() => ($$('.results .row').length === store('search').visibleSongs.length && store('search').visibleSongs.length > 0 ? true : null), 20000)
await sleep(400)
out.immediately = coverage()

// 滚完整张表（触发懒加载），再等图片解码完
const body = $('.results .body')
body.scrollTop = 0
for (let i = 0; i < 30; i += 1) {
  const before = body.scrollTop
  body.scrollTop = Math.min(before + body.clientHeight * 1.2, body.scrollHeight)
  await sleep(90)
  if (body.scrollTop === before) break
}
await waitFor(() => ($$('.results .row img').every((i) => i.complete) ? true : null), 8000, 200)
await sleep(500)
out.afterFullScroll = coverage()

// 回顶再看一次（真实用户视角）
body.scrollTop = 0
await sleep(400)
out.afterBackToTop = coverage()

out.verdict =
  out.afterFullScroll.loaded >= out.afterFullScroll.imgEls * 0.95
    ? '滚完列表后覆盖率 ≥95%：懒加载只是把加载推迟到进入视口，没有丢封面'
    : '仍有较多封面没加载出来，需要查 CoverImage 链路'

return out
