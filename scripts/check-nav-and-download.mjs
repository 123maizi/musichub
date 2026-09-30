/**
 * 两个失败项的根因定位：
 * A. 怎么才能进「正在播放」页（hash 直跳似乎失效）
 * B. 行内「下载为」按钮为什么点了不入队
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const identity = () =>
  document.querySelector('.stage')
    ? '正在播放页'
    : document.querySelector('.results .row')
      ? '搜索页'
      : document.querySelector('.rail') && document.querySelector('.page')
        ? '其它页:' + (document.querySelector('.page')?.className ?? '')
        : '未知'
const out = { A_进入正在播放页: [], B_下载按钮: {} }

// 回到搜索页（点导航柱，最可靠）
const railClick = async (label) => {
  const b = [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(label)
  )
  if (b) b.click()
  await sleep(1200)
}

await railClick('搜索')
out.A_进入正在播放页.push({ 方式: '起点', hash: location.hash, 身份: identity() })

// 方式 1：直接从搜索页改 hash
location.hash = '#/now-playing'
await sleep(2500)
out.A_进入正在播放页.push({ 方式: '① 直接改 hash', hash: location.hash, 身份: identity() })

// 方式 2：先跳到别页再跳过来（强制产生 hash 变化）
await railClick('音源')
await sleep(800)
location.hash = '#/now-playing'
await sleep(2500)
out.A_进入正在播放页.push({ 方式: '② 先跳别页再改 hash', hash: location.hash, 身份: identity() })

// 方式 3：点底部播放条的封面/标题
await railClick('搜索')
await sleep(800)
const clickable = [...document.querySelectorAll('footer.player-bar *')].filter((el) => {
  const r = el.getBoundingClientRect()
  return r.width > 30 && r.height > 30 && el.tagName !== 'FOOTER'
})
if (clickable[0]) {
  clickable[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(2500)
}
out.A_进入正在播放页.push({
  方式: '③ 点播放条封面区',
  hash: location.hash,
  身份: identity(),
  点击目标: clickable[0] ? clickable[0].tagName + '.' + (clickable[0].className || '') : null
})

// 方式 4：点行内播放按钮
await railClick('搜索')
await sleep(800)
const rows = [...document.querySelectorAll('.results .row')]
const playBtn = rows[0]?.querySelector('.col-actions button[title="播放"]')
playBtn?.click()
await sleep(3000)
out.A_进入正在播放页.push({ 方式: '④ 点行内播放键', hash: location.hash, 身份: identity() })

// ---- B. 下载按钮 ----
await railClick('搜索')
await sleep(1000)
const dlBtn = document.querySelector('.results .row .col-actions button[title^="下载为"]')
const before = (await window.api.download.list()).length
if (dlBtn) {
  out.B_下载按钮 = {
    找到: true,
    title: dlBtn.getAttribute('title'),
    可见: dlBtn.offsetParent !== null,
    尺寸: Math.round(dlBtn.getBoundingClientRect().width) + 'x' + Math.round(dlBtn.getBoundingClientRect().height),
    命中点元素: (() => {
      const r = dlBtn.getBoundingClientRect()
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return el === dlBtn || dlBtn.contains(el) ? '按钮自身 ✓' : '被遮挡 → ' + (el?.className || el?.tagName)
    })(),
    点击前任务数: before
  }
  dlBtn.click()
  await sleep(2500)
  out.B_下载按钮.点击后任务数 = (await window.api.download.list()).length
  out.B_下载按钮.结论 = out.B_下载按钮.点击后任务数 > before ? '入队成功' : '未入队 ✗'
} else {
  out.B_下载按钮 = { 找到: false, 行内按钮: rows[0] ? [...rows[0].querySelectorAll('button')].map((b) => b.getAttribute('title')) : [] }
}

return JSON.stringify(out, null, 1)
