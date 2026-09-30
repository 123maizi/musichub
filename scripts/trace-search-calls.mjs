/**
 * 给搜索 IPC 打桩，记录每一次调用的关键词、时间、以及调用栈。
 * 用来定位「谁在反复发起搜索」。
 *
 * 注意：本文件由 cdp.mjs 包进模板字符串执行，**不能用反引号或 ${}**，
 * 一律用字符串拼接。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

window.__searchCalls = []
const orig = window.api.search.search
window.api.search.search = async function (req) {
  const stack = new Error().stack
    .split('\n')
    .slice(2, 6)
    .map(function (s) {
      return s.trim()
    })
    .join(' | ')
  window.__searchCalls.push({
    t: Date.now(),
    keyword: req ? req.keyword : null,
    page: req ? req.page : null,
    limit: req ? req.limit : null,
    platforms: req ? req.platforms : null,
    channel: req ? req.channel : null,
    stack: stack
  })
  return orig.call(window.api.search, req)
}

window.location.hash = '#/search'
await sleep(2000)
const beforeSearch = window.__searchCalls.length
const input = document.querySelector('.search-box input')
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(200)
input.value = '周杰伦'
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(800)
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
await sleep(9000)

const duringSearch = window.__searchCalls.length - beforeSearch

const perRoute = {}
const routes = ['#/artists', '#/albums', '#/library', '#/sources', '#/settings', '#/downloads', '#/nowplaying']
for (const hash of routes) {
  const before = window.__searchCalls.length
  window.location.hash = hash
  await sleep(6000)
  perRoute[hash] = window.__searchCalls.length - before
}

const calls = window.__searchCalls
const byKeyword = {}
for (const c of calls) {
  const k = String(c.keyword) + '|p' + c.page + '|lim' + c.limit + '|' + c.channel
  byKeyword[k] = (byKeyword[k] || 0) + 1
}

let sameMsPairs = 0
for (let i = 1; i < calls.length; i += 1) {
  if (calls[i].t - calls[i - 1].t < 30) sameMsPairs += 1
}

return JSON.stringify(
  {
    搜索页期间调用次数: duringSearch,
    各路由新增调用: perRoute,
    总调用次数: calls.length,
    按关键词聚合: byKeyword,
    三十毫秒内的连续调用对数: sameMsPairs,
    明细: calls.slice(0, 8).map(function (c) {
      return {
        关键词: c.keyword,
        页: c.page,
        上限: c.limit,
        通道: c.channel,
        平台: c.platforms,
        栈: c.stack.slice(0, 220)
      }
    })
  },
  null,
  1
)
