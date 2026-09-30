/**
 * 导航诊断（task-8 专用，一次性）
 *
 * 现象：一轮开始时 #/downloads / #/settings 都能挂上（视图身份 OK），
 * 但 acceptance.mjs 跑完之后，再 `location.hash = '#/downloads'` 就只剩搜索页 ——
 * hash 变了、DOM 不变。要分清是「hash 赋值这条路失灵」还是「组件本身挂了」。
 *
 * 判据：改用**用户真实路径**——点左侧导航柱（App.vue 的 .nav-item → router.push）。
 * 同时把 console.error / window.onerror / unhandledrejection 全接住，
 * 组件 setup 里抛错会立刻现形。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { steps: {} }

const errs = []
const origError = console.error.bind(console)
console.error = (...a) => {
  errs.push(a.map((x) => String(x)).join(' ').slice(0, 400))
  origError(...a)
}
window.addEventListener('error', (e) => errs.push('window.onerror: ' + String(e.message || '').slice(0, 200)))
window.addEventListener('unhandledrejection', (e) =>
  errs.push('unhandledrejection: ' + String(e.reason && e.reason.message ? e.reason.message : e.reason).slice(0, 200))
)

function scene(tag) {
  const main = document.querySelector('main')
  const text = (document.body.innerText || '').replace(/\s+/g, ' ')
  return {
    tag,
    hash: location.hash,
    mainKids: main ? [...main.children].map((e) => e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]) : [],
    fmt: document.querySelectorAll('.fmt').length,
    taskRows: document.querySelectorAll('.task').length,
    checkboxes: document.querySelectorAll('.check input').length,
    groups: document.querySelectorAll('.group').length,
    hasDownloadMark: text.includes('下载格式'),
    hasSettingsMark: text.includes('AI 歌词翻译'),
    head: text.slice(0, 80)
  }
}

const rail = [...document.querySelectorAll('.nav-item')].map((b) => b.getAttribute('aria-label'))
out.steps.rail = rail

function clickRail(label) {
  const b = [...document.querySelectorAll('.nav-item')].find((x) => (x.getAttribute('aria-label') || '') === label)
  if (!b) return false
  b.click()
  return true
}

out.steps.start = scene('起点')

// A. hash 赋值（我原来用的路）
location.hash = '#/search'
await sleep(1400)
out.steps.hashToSearch = scene('hash → #/search')
location.hash = '#/downloads'
await sleep(2000)
out.steps.hashToDownloads = scene('hash → #/downloads')

// B. 真实导航柱
out.steps.clickSearch = clickRail('搜索')
await sleep(1500)
out.steps.afterClickSearch = scene('点「搜索」')
out.steps.clickDownloads = clickRail('下载')
await sleep(2200)
out.steps.afterClickDownloads = scene('点「下载」')
out.steps.clickSettings = clickRail('设置')
await sleep(2200)
out.steps.afterClickSettings = scene('点「设置」')
out.steps.clickDownloads2 = clickRail('下载')
await sleep(2200)
out.steps.afterClickDownloads2 = scene('再点「下载」')

// C. 再来一次 hash，看是否仍然失灵
location.hash = '#/settings'
await sleep(2000)
out.steps.hashToSettings = scene('hash → #/settings')

out.steps.errors = errs.slice(0, 20)
return out
