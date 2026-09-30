/**
 * 封面覆盖率实测探针 v2（真实 DOM 判据 + 懒加载友好协议）。
 *
 * 判据（硬）：真的加载出来了 = 该行渲染出 <img> 且 img.complete && img.naturalWidth > 0。
 * 只数 <img> 标签数量是不作数的 —— 挂掉的 <img> 也是标签。
 *
 * v2 修正了两个测量陷阱：
 *  1) 收敛判据必须把「还在加载中的图」算进去。只看 loaded/placeholder 数量会
 *     在请求仍挂起时误判为「已经稳定」，把慢图记成失败。
 *  2) 要给 <img loading="lazy"> 一个公平的机会：先把列表从头滚到底，
 *     再统计全量覆盖率，否则懒加载会被误读成「封面变少了」。
 */
const KEYWORD = window.__coverProbeKeyword || '周杰伦'
/** 稳定窗口可调：验证「失败后 30 秒自愈重试」时需要把它拉长到 40 秒以上 */
const SETTLE_MS = Number(window.__coverProbeSettle || 8000)
const MAX_WAIT_MS = 150000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function store() {
  const vueApp = document.querySelector('#app')?.__vue_app__
  const pinia = vueApp?.config?.globalProperties?.$pinia
  return pinia?._s?.get?.('search') ?? null
}

/* --------------------------- 1. 真实 UI 搜索 --------------------------- */
location.hash = '#/search'
await sleep(600)

const input = document.querySelector('.search-box input')
if (!input) throw new Error('找不到搜索框，界面没起来？')
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
setter.call(input, KEYWORD)
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(150)
document.querySelector('.search-box button.primary')?.click()

/* --------------------------- 2. 等结果行 --------------------------- */
let rows = 0
const searchStart = performance.now()
for (let i = 0; i < 60; i += 1) {
  await sleep(500)
  rows = document.querySelectorAll('.results .row').length
  if (rows > 0) break
}
const searchMs = Math.round(performance.now() - searchStart)

/* --------------------------- 3. 等首屏收敛 --------------------------- */
let lastKey = ''
let stableSince = performance.now()
const settleStart = performance.now()
for (;;) {
  const s = snapshot()
  const key = `${s.loaded}|${s.placeholder}|${s.failedTag}|${s.pending}`
  if (key !== lastKey) {
    lastKey = key
    stableSince = performance.now()
  }
  if (performance.now() - stableSince > SETTLE_MS) break
  if (performance.now() - settleStart > MAX_WAIT_MS) break
  await sleep(600)
}
const firstScreen = snapshot()

/* --------------------------- 4. 滚到底，给懒加载机会 --------------------------- */
const scroller = document.querySelector('.results .body') ?? document.scrollingElement
const scrollInfo = { steps: 0, scrollHeight: scroller?.scrollHeight ?? 0 }
if (scroller) {
  const step = Math.max(200, Math.floor((scroller.clientHeight || 600) * 0.7))
  for (let top = 0; top <= scroller.scrollHeight; top += step) {
    scroller.scrollTop = top
    scrollInfo.steps += 1
    await sleep(300)
  }
  scroller.scrollTop = 0
  await sleep(300)
}

/* 滚动后再等一次收敛（这次把 pending 也算进稳定性判据） */
async function settle(label) {
  let key = ''
  let since = performance.now()
  const t0 = performance.now()
  for (;;) {
    const s = snapshot()
    const k = `${s.rows}|${s.loaded}|${s.placeholder}|${s.failedTag}|${s.pending}`
    if (k !== key) {
      key = k
      since = performance.now()
    }
    if (performance.now() - since > SETTLE_MS) return s
    if (performance.now() - t0 > MAX_WAIT_MS) {
      return s
    }
    await sleep(600)
  }
}
let finalSnap = await settle('scroll')

/**
 * 兜底测量：把还挂着的懒加载图强制转成 eager。
 *
 * 为什么需要：`loading="lazy"` 的图只有在接近视口时才会真正发请求，
 * 快速滚过去可能压根没触发。这一步把「懒加载没轮到」和「地址真的挂了」
 * 区分开 —— 否则会把懒加载误报成封面加载失败。
 */
let forced = 0
for (const img of document.querySelectorAll('.results .row .mini-cover img')) {
  if (!img.complete) {
    img.loading = 'eager'
    forced += 1
  }
}
if (forced > 0) {
  await sleep(400)
  finalSnap = await settle('forced')
}

function snapshot() {
  const s = store()
  const songs = s?.visibleSongs ?? []
  const domRows = [...document.querySelectorAll('.results .row')]
  const detail = []
  let imgTags = 0
  let loaded = 0
  let placeholder = 0
  let failedTag = 0
  let pending = 0
  let resolvedCount = 0
  let proxyCount = 0
  const byPlatform = {}

  domRows.forEach((row, index) => {
    const song = songs[index] ?? null
    const img = row.querySelector('.mini-cover img')
    const platform = song?.platform ?? '?'
    byPlatform[platform] ??= { total: 0, loaded: 0, placeholder: 0, failedTag: 0, pending: 0 }
    byPlatform[platform].total += 1

    let state = 'placeholder'
    let src = ''
    if (img) {
      imgTags += 1
      src = img.getAttribute('src') || ''
      if (img.complete && img.naturalWidth > 0) {
        state = 'loaded'
        loaded += 1
        byPlatform[platform].loaded += 1
      } else if (!img.complete) {
        state = 'pending'
        pending += 1
        byPlatform[platform].pending += 1
      } else {
        state = 'failedTag'
        failedTag += 1
        byPlatform[platform].failedTag += 1
      }
    } else {
      placeholder += 1
      byPlatform[platform].placeholder += 1
    }

    const pic = song?.picUrl ? String(song.picUrl) : ''
    if (state === 'loaded' && src && src !== pic) {
      resolvedCount += 1
      if (src.includes('127.0.0.1')) proxyCount += 1
    }

    detail.push({ i: index + 1, name: song?.name ?? '?', platform, state, hasPic: !!pic })
  })

  return {
    rows: domRows.length,
    songs: songs.length,
    imgTags,
    loaded,
    placeholder,
    failedTag,
    pending,
    resolvedCount,
    proxyCount,
    byPlatform,
    detail
  }
}

const total = finalSnap.rows || 1
const report = {
  关键词: KEYWORD,
  搜索耗时ms: searchMs,
  结果行数: finalSnap.rows,
  滚动步数: scrollInfo.steps,
  强制转eager的图片数: forced,
  首屏: {
    'img标签数': firstScreen.imgTags,
    '加载成功': firstScreen.loaded,
    占位: firstScreen.placeholder,
    加载失败: firstScreen.failedTag,
    仍在加载: firstScreen.pending
  },
  全量: {
    'img标签数': finalSnap.imgTags,
    '真实加载成功(naturalWidth>0)': finalSnap.loaded,
    '占位图标(无img)': finalSnap.placeholder,
    'img标签但加载失败': finalSnap.failedTag,
    '仍在加载': finalSnap.pending,
    覆盖率: `${((finalSnap.loaded / total) * 100).toFixed(1)}%`,
    '补图生效条数': finalSnap.resolvedCount,
    '走本地代理的条数': finalSnap.proxyCount
  },
  分平台: finalSnap.byPlatform,
  未加载明细: finalSnap.detail.filter((d) => d.state !== 'loaded').slice(0, 40)
}
return JSON.stringify(report, null, 1)
