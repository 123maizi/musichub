/**
 * 定位两个 bug：
 * A. 是所有路由都换不了视图，还是只有 #/now-playing？
 * B. 点「下载为」时渲染层到底发生了什么（抓 console + 未捕获异常）
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

// 安装错误采集（只装一次）
if (!window.__probeLog) {
  window.__probeLog = []
  const origErr = console.error
  console.error = (...a) => {
    window.__probeLog.push('console.error: ' + a.map((x) => String(x)).join(' ').slice(0, 300))
    origErr.apply(console, a)
  }
  window.addEventListener('error', (e) => window.__probeLog.push('window.error: ' + String(e.message).slice(0, 300)))
  window.addEventListener('unhandledrejection', (e) =>
    window.__probeLog.push('unhandledrejection: ' + String(e.reason?.message ?? e.reason).slice(0, 300))
  )
}
window.__probeLog.length = 0

const ident = () =>
  document.querySelector('.stage')
    ? '正在播放'
    : document.querySelector('.results .row')
      ? '搜索'
      : document.querySelector('.rail-stats')
        ? '有外壳·' +
          (document.querySelector('.page')?.firstElementChild?.className || document.querySelector('.page')?.firstElementChild?.tagName || '空')
        : '未知'

const railClick = async (label) => {
  const b = [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(label)
  )
  if (b) b.click()
  await sleep(1500)
}

// A. 逐个导航项测视图是否真的换
await railClick('搜索')
out.A_各路由是否换视图 = [{ 目标: '起点(搜索)', hash: location.hash, 视图: ident() }]
for (const [label, want] of [
  ['我的', '#/library'],
  ['下载', '#/downloads'],
  ['音源', '#/sources'],
  ['设置', '#/settings'],
  ['搜索', '#/search']
]) {
  await railClick(label)
  await sleep(1200)
  out.A_各路由是否换视图.push({
    目标: label,
    hash: location.hash,
    期望hash: want,
    hash对: location.hash === want ? '✓' : '✗',
    视图: ident(),
    残留leave类: document.querySelectorAll('.route-leave-active').length,
    顶栏标题: (document.querySelector('header h1, .topbar h1')?.textContent ?? '').trim()
  })
}

// now-playing：从搜索页改 hash
location.hash = '#/now-playing'
await sleep(3000)
out.A_nowplaying = {
  hash: location.hash,
  视图: ident(),
  顶栏标题: (document.querySelector('header h1, .topbar h1')?.textContent ?? '').trim(),
  残留leave类: document.querySelectorAll('.route-leave-active').length,
  页面文本前80字: (document.querySelector('.page')?.innerText ?? '').trim().slice(0, 80)
}

// B. 下载按钮
await railClick('搜索')
await sleep(1200)
window.__probeLog.length = 0
const dl = document.querySelector('.results .row .col-actions button[title^="下载为"]')
const before = (await window.api.download.list()).length
let manual = null
if (dl) {
  dl.click()
  await sleep(2500)
  const after = (await window.api.download.list()).length
  // 如果 UI 点击无效，直接调 IPC 看是不是后端问题
  try {
    const rows = [...document.querySelectorAll('.results .row')]
    manual = '未测'
  } catch (e) {
    manual = String(e.message)
  }
  out.B_下载 = {
    按钮title: dl.getAttribute('title'),
    点击前: before,
    点击后: after,
    结果: after > before ? '入队成功' : '未入队 ✗',
    采集到的日志: window.__probeLog.slice(0, 8)
  }
} else {
  out.B_下载 = { 找到按钮: false }
}

return JSON.stringify(out, null, 1)
