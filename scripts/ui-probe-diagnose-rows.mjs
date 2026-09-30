/**
 * 诊断：下载页任务行为什么不渲染（task-8 调试用，一次性）
 *
 * 现象：主进程 download.list() 里有 4 条任务，下载页 DOM 里 .task 一个都没有。
 * 要分清三种可能：
 *   A. 根本没在下载页（路由 / 视图没挂）
 *   B. 在下载页但 store.tasks 是空的（refresh 没跑 / push 事件没到）
 *   C. 渲染条件不满足
 * 判据：把 location.hash、视图根元素、.empty / .task 数量、主进程任务数
 * 四样东西放在同一时刻一起读。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { steps: {} }

/**
 * 视图身份断言。
 *
 * 这一轮踩过的坑：并发构建让懒加载 chunk 404，`location.hash` 已经变成
 * `#/downloads`，但 DOM 里还停在搜索页 —— 于是「下载页没有任务行」这种
 * 假结论就出来了。任何针对某个页面的测量都必须先证明「这个页面真的挂上了」，
 * 否则数字全是别人的页面的。
 */
const VIEW_MARKERS = {
  '#/downloads': ['还没有下载任务', '下载格式'],
  '#/settings': ['AI 歌词翻译', '下载目录'],
  '#/search': ['输入关键词开始', '下载格式']
}
async function assertView(route) {
  const text = document.body.innerText || ''
  const markers = VIEW_MARKERS[route] || []
  const hit = markers.filter((m) => text.includes(m))
  return { route, hash: location.hash, markers: markers, hit: hit, ok: hit.length > 0 }
}

const snap = async (tag) => {
  const main = await window.api.download.list()
  const view = document.querySelector('main > *')
  return {
    tag,
    hash: location.hash,
    viewTag: view ? view.tagName.toLowerCase() + '.' + String(view.className).split(' ')[0] : null,
    viewText: view ? (view.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90) : null,
    taskRows: document.querySelectorAll('.task').length,
    emptyRows: document.querySelectorAll('.empty').length,
    barFills: document.querySelectorAll('.bar > i').length,
    mainTasks: main.length,
    mainStatuses: main.map((t) => t.status)
  }
}

location.hash = '#/downloads'
await sleep(2500)
out.steps.viewIdentity = await assertView('#/downloads')
out.steps.beforeAdd = await snap('刚进下载页（此时主进程无任务）')

// 用真实 UI 路径加一条：搜索页点行内下载按钮（这才是用户走的路）
location.hash = '#/search'
await sleep(1500)
out.steps.searchRowButtons = await (async () => {
  const row = document.querySelector('.results .row')
  if (!row) return null
  return [...row.querySelectorAll('.col-actions button')].map((b) => b.getAttribute('title') || (b.textContent || '').trim())
})()
location.hash = '#/downloads'
await sleep(2000)
out.steps.afterRoundTrip = await snap('搜索页往返一次之后')

// 直接用 API 加一条，看 push 事件能不能把行带出来
const res = await window.api.search.search({ keyword: '晴天 周杰伦', limit: 10 })
const all = res.platforms.flatMap((p) => p.songs || [])
const song = all.find((s) => s.platform === 'tx') || all[0]
await window.api.download.setConfig({
  dir: 'F:\\MusicHub\\.tmp-ui\\diag-downloads',
  concurrency: 2,
  writeTag: false,
  downloadCover: false,
  downloadLyric: false
})
const created = await window.api.download.add({
  songs: [JSON.parse(JSON.stringify(song))],
  quality: '128k'
})
out.steps.addedId = created[0].id
await sleep(3000)
out.steps.afterApiAdd = await snap('API 入队 3 秒后（store 靠 push 事件）')

// 离开再回来，看 onMounted 的 refresh 会不会补上
location.hash = '#/settings'
await sleep(1200)
location.hash = '#/downloads'
await sleep(2500)
out.steps.afterRemount = await snap('离开再回来之后（onMounted refresh）')

// 收尾
try {
  await window.api.download.remove([created[0].id], false)
} catch {
  /* ignore */
}

return out
