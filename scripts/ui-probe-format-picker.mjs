/**
 * 「下载格式选择器」行为三连验证探针（task-8 专用）
 *
 * 选择器的**样式**归 cover-fix（它是原语层），但它的**行为**是既有功能，
 * 任何视觉改动都不许碰坏。这个探针把三件事钉死：
 *   ① 立即生效：点完 250ms 内主进程的 config.preferQuality 必须已经变
 *   ② 落盘：探针把「切换后的值」交给宿主机，由宿主机去读
 *      <profile>/download-config.json 确认真的写进磁盘了（防抖 300ms）
 *   ③ 新任务用新格式：不带 quality 入队一个任务，返回的 task.quality 必须等于新格式
 * 最后把格式**还原**，并把还原后的值也交给宿主机核对（免得把用户配置改跑偏）。
 *
 * 这里用元素级 MouseEvent 序列（mousedown/mouseup/click）而不是裸 .click()：
 * 坐标取自真实 rect 中心，与用户点击落点一致；acceptance.mjs 也在用 .click()，
 * 但这里多做一层坐标就多一层「点到了真东西」的证据。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { steps: {} }

const describe = (el) => ({
  label: (el.querySelector('b')?.textContent || '').trim(),
  rate: (el.querySelector('span')?.textContent || '').trim(),
  active: el.classList.contains('active'),
  disabled: Boolean(el.disabled)
})

/* ---------- 0. 站到下载页 ---------- */
/**
 * 导航一律点导航柱（router.push），不用 `location.hash = ...`。
 * 实测后者在这个外壳里不可靠：hash 会变、顶栏标题也变，但 main 里的视图常常不换。
 * 点导航柱既更接近用户真实操作，也每次都成功。
 */
async function railGo(label, waitMs = 1800) {
  const b = [...document.querySelectorAll('.nav-item')].find(
    (x) => (x.getAttribute('aria-label') || '') === label
  )
  if (b) b.click()
  else location.hash = '#/' + label
  await sleep(waitMs)
}
await railGo('下载')

/**
 * 先确认「下载页真的挂上了」再断言选择器存在。
 * 上一轮就是在这里翻车的：懒加载 chunk 失效时 hash 会照常变、DOM 却停在搜索页，
 * 于是报出一句「找不到下载格式选择器」，看起来像选择器坏了。
 * 现在失败时把现场 DOM 一起带回来，一眼能分清是「页面没挂」还是「选择器真没了」。
 */
function scene(tag) {
  const main = document.querySelector('main')
  const kids = main ? [...main.children].map((e) => e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]) : []
  return {
    tag,
    hash: location.hash,
    mainKids: kids,
    views: document.querySelectorAll('main > *').length,
    fmt: document.querySelectorAll('.fmt').length,
    opts: document.querySelectorAll('.opts').length,
    optBtns: document.querySelectorAll('.opt').length,
    tasks: document.querySelectorAll('.task').length,
    skeleton: document.querySelectorAll('.skeleton-list').length,
    empty: document.querySelectorAll('.empty').length,
    text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160)
  }
}
out.steps.sceneAtStart = scene('刚进下载页')

let opts = [...document.querySelectorAll('.fmt .opts .opt')]
for (let i = 0; i < 20 && opts.length === 0; i += 1) {
  await sleep(300)
  opts = [...document.querySelectorAll('.fmt .opts .opt')]
}
if (opts.length === 0) {
  out.steps.sceneAtFailure = scene('找不到选择器时')
  throw new Error('找不到下载格式选择器：' + JSON.stringify(out.steps.sceneAtFailure))
}

const cfg0 = await window.api.download.getConfig()
out.steps.beforeValue = cfg0.preferQuality
out.steps.options = opts.map(describe)
out.steps.activeIndexBefore = opts.findIndex((o) => o.classList.contains('active'))
if (out.steps.activeIndexBefore < 0) out.steps.warn = '点开页面时没有任何一项是选中态'

/* ---------- 1. 点一个当前没选中的格式（真实坐标 + 真实事件序列） ---------- */
const target = opts.find((o) => !o.classList.contains('active') && !o.disabled)
if (!target) throw new Error('没有可切换的格式项')
out.steps.target = describe(target)

const rect = target.getBoundingClientRect()
out.steps.targetRect = {
  x: Math.round(rect.left),
  y: Math.round(rect.top),
  w: Math.round(rect.width),
  h: Math.round(rect.height)
}
const cx = rect.left + rect.width / 2
const cy = rect.top + rect.height / 2
for (const type of ['mousedown', 'mouseup', 'click']) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cx,
      clientY: cy,
      button: 0
    })
  )
}

/* ---------- 2. 立即生效（不等防抖） ---------- */
await sleep(250)
const cfg1 = await window.api.download.getConfig()
out.steps.after250ms = cfg1.preferQuality
out.steps.immediateEffect = cfg1.preferQuality !== cfg0.preferQuality
out.steps.newValue = cfg1.preferQuality

/* ---------- 3. 选中态跟着走（视觉与数据一致） ---------- */
const optsAfter = [...document.querySelectorAll('.fmt .opts .opt')]
out.steps.activeIndexAfter = optsAfter.findIndex((o) => o.classList.contains('active'))
out.steps.activeMoved = out.steps.activeIndexAfter === opts.indexOf(target)
out.steps.activeLabelAfter = out.steps.activeIndexAfter >= 0 ? describe(optsAfter[out.steps.activeIndexAfter]) : null

/* ---------- 4. 新任务用新格式 ---------- */
try {
  const res = await window.api.search.search({ keyword: '晴天 周杰伦', limit: 10 })
  const all = res.platforms.flatMap((p) => p.songs || [])
  const song = all.find((s) => s.platform === 'tx') || all[0]
  if (!song) throw new Error('搜索没有结果')
  const created = await window.api.download.add({
    songs: [JSON.parse(JSON.stringify(song))]
  })
  out.steps.newTaskQuality = created[0].quality
  out.steps.newTaskUsesNewFormat = created[0].quality === cfg1.preferQuality
  // 立刻收掉，别让它真的把文件拉下来
  await window.api.download.remove([created[0].id], false)
  out.steps.taskCleanedUp = true
} catch (err) {
  out.steps.newTaskError = String(err && err.message)
}

/* ---------- 5. 还原原格式（并把还原值交给宿主机核对落盘） ---------- */
try {
  if (opts[out.steps.activeIndexBefore]) {
    const back = opts[out.steps.activeIndexBefore]
    const br = back.getBoundingClientRect()
    const bx = br.left + br.width / 2
    const by = br.top + br.height / 2
    for (const type of ['mousedown', 'mouseup', 'click']) {
      back.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: bx,
          clientY: by,
          button: 0
        })
      )
    }
  } else {
    await window.api.download.setConfig({ preferQuality: cfg0.preferQuality })
  }
  await sleep(300)
  const cfg2 = await window.api.download.getConfig()
  out.steps.restoredValue = cfg2.preferQuality
  out.steps.restored = cfg2.preferQuality === cfg0.preferQuality
} catch (err) {
  out.steps.restoreError = String(err && err.message)
}

/* 宿主机据此核对磁盘：newValue 与 restoredValue 都应能（在不同时刻）读到 */
out.steps.hostCheckDiskFor = { newValue: out.steps.newValue, restoredValue: out.steps.restoredValue }

return out
