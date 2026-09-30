/**
 * 渲染性能量化探针（render-perf 专用，CDP 9225）。
 *
 * 一次跑完下列指标，输出 JSON：
 *  1. 搜索「周杰伦」：结果首行出现 → 全部行挂载完成的耗时、行数、DOM 节点总数
 *  2. 搜索期间的长任务（longtask）数量与总时长
 *  3. 真实滚轮滚动过程中的掉帧统计（rAF 帧间隔）
 *  4. 全表重渲染成本：切多选模式（给每行加复选框）的耗时
 *  5. JS 堆占用
 *
 * 用法： node scripts/perf-probe.mjs <标签>
 */
const PORT = Number(process.env.PERF_CDP_PORT || 9225)
const LABEL = process.argv[2] || 'run'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pickPage() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const list = await res.json()
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error(`端口 ${PORT} 上没有渲染进程 target`)
  return page
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let id = 0
    const pending = new Map()
    ws.addEventListener('open', () =>
      resolve({
        send(method, params) {
          return new Promise((res, rej) => {
            const mid = ++id
            // 每个 CDP 调用都带超时：挂死时给出明确错误，而不是无限等待
            const timer = setTimeout(() => {
              pending.delete(mid)
              rej(new Error(`CDP ${method} 超时 60s`))
            }, 60000)
            pending.set(mid, {
              res: (v) => {
                clearTimeout(timer)
                res(v)
              },
              rej: (e) => {
                clearTimeout(timer)
                rej(e)
              }
            })
            ws.send(JSON.stringify({ id: mid, method, params }))
          })
        },
        close: () => ws.close()
      })
    )
    ws.addEventListener('error', () => reject(new Error('WS 连接失败')))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) rej(new Error(JSON.stringify(msg.error)))
        else res(msg.result)
      }
    })
  })
}

async function evaluate(cdp, expression) {
  const out = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  })
  if (out.exceptionDetails) {
    const d = out.exceptionDetails
    throw new Error(d.exception?.description ?? d.text ?? '页面内执行异常')
  }
  return out.result?.value
}

/** 在页面里执行一段源码（async IIFE 内），可 await / return */
async function evalfile(cdp, src) {
  const raw = await evaluate(cdp, `(async () => { ${src} })()`)
  return raw
}

const page = await pickPage()
const cdp = await connect(page.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')
// 让窗口到前台：被遮挡时 Chromium 会节流 rAF，帧统计会失真
try {
  await cdp.send('Page.enable')
  await cdp.send('Page.bringToFront')
} catch {
  /* 拿不到前台也不影响正确性指标 */
}
await sleep(400)

const report = { label: LABEL, at: new Date().toISOString(), port: PORT }
/** 分步日志：探针挂掉时能一眼看出卡在哪一步 */
const step = (m) => console.error(`[perf] ${m} @${new Date().toISOString().slice(11, 19)}`)

/* ---------------- 0. 等音源装载完（首启要导入内置音源） ---------------- */
step('0 等音源就绪')
report.sources = await evalfile(
  cdp,
  `
  const deadline = Date.now() + 25000
  let list = []
  while (Date.now() < deadline) {
    try { list = await window.api.source.list() } catch { list = [] }
    if (list.filter(s => s.status === 'ready').length > 0) break
    await new Promise(r => setTimeout(r, 500))
  }
  return { total: list.length, ready: list.filter(s => s.status === 'ready').length }
`
)

/* ---------------- 1. 回到搜索页并清空 ---------------- */
step('1 回到搜索页')
report.page = await evalfile(
  cdp,
  `
  window.location.hash = '#/search'
  await new Promise(r => setTimeout(r, 600))
  const input = document.querySelector('.search-box input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 120))
  return { hash: location.hash, hasInput: !!input, rows: document.querySelectorAll('.results .row').length }
`
)

/* ---------------- 2. 搜索 周杰伦 + 观测 ---------------- */
step('2 搜索并观测挂载')
const mount = await evalfile(
  cdp,
  `
  const $ = (s) => document.querySelector(s)
  const rows = () => document.querySelectorAll('.results .row').length
  const nodes = () => document.getElementsByTagName('*').length

  // 长任务观测
  const longTasks = []
  let po = null
  try {
    po = new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push({ start: e.startTime, dur: Math.round(e.duration) }) })
    po.observe({ entryTypes: ['longtask'] })
  } catch {}

  const root = $('.results')
  let mutated = 0
  let addedNodes = 0
  const obs = new MutationObserver((records) => {
    mutated += 1
    for (const r of records) addedNodes += r.addedNodes.length
  })
  obs.observe(root, { childList: true, subtree: true })

  const input = $('.search-box input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '周杰伦')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 150))

  const btn = [...document.querySelectorAll('.search-box button')].find(b => b.innerText.includes('搜索'))
  const t0 = performance.now()
  btn.click()

  // 等首行
  let firstRowAt = 0
  const waitStart = Date.now()
  while (Date.now() - waitStart < 20000) {
    if (rows() > 0) { firstRowAt = performance.now(); break }
    await new Promise(r => setTimeout(r, 20))
  }

  // 等行数稳定（连续 700ms 不变）
  let last = rows()
  let stableSince = performance.now()
  let allRowsAt = 0
  while (Date.now() - waitStart < 25000) {
    await new Promise(r => setTimeout(r, 50))
    const n = rows()
    if (n !== last) { last = n; stableSince = performance.now() }
    else if (performance.now() - stableSince > 700 && n > 0) { allRowsAt = stableSince; break }
  }

  await new Promise(r => setTimeout(r, 300))
  obs.disconnect()
  if (po) po.disconnect()

  // 只统计「点搜索之后」这段时间里的长任务，避免混进无关活动
  const win = longTasks.filter((t) => t.start >= t0 && t.start <= t0 + (allRowsAt - t0) + 200)

  const body = $('.results .body')
  return {
    rowCount: last,
    firstRowAfterMs: Math.round(firstRowAt - t0),
    allRowsAfterMs: Math.round(allRowsAt - t0),
    mountWindowMs: Math.round(allRowsAt - firstRowAt),
    domNodesTotal: nodes(),
    domNodesPerRow: last > 0 ? Number(((nodes()) / last).toFixed(2)) : null,
    mutationCallbacks: mutated,
    addedNodesViaMutation: addedNodes,
    longTaskCount: win.length,
    longTaskTotalMs: Math.round(win.reduce((s, t) => s + t.dur, 0)),
    longTaskMaxMs: win.length ? Math.max(...win.map((t) => t.dur)) : 0,
    longTasks: win.slice(0, 12),
    coverImgs: document.querySelectorAll('.results .row img').length,
    rowContentVisibility: (() => {
      const r = document.querySelector('.results .row')
      return r ? getComputedStyle(r).contentVisibility : null
    })(),
    bodyScrollHeight: body ? body.scrollHeight : null,
    bodyClientHeight: body ? body.clientHeight : null,
    screens: body ? Number((body.scrollHeight / body.clientHeight).toFixed(2)) : null
  }
`
)
report.mount = mount

/* ---------------- 3. 滚动整表 13 屏的帧耗时 ---------------- */
step('3 滚动帧耗时')
// 窗口被遮挡时 rAF 会被节流，先确保在前台（启动参数里也关了后台节流，双保险）
try {
  await cdp.send('Page.bringToFront')
} catch {
  /* 拿不到前台也不致命 */
}
await sleep(300)
/*
 * 早期版本用 CDP Input.dispatchMouseEvent 派发真实滚轮，更接近真人操作，
 * 但在后台窗口/被遮挡时会卡在事件 ack 上（实测挂死 6 分钟）。
 * 改成页内 rAF 驱动 scrollTop：每帧滚 0.8 屏，滚完整张表，
 * 逐帧记录帧间隔。测的是同样的东西（每帧的样式计算 + 布局 + 绘制），
 * 但不依赖输入管道，稳定可复现。
 */
// PERF_CV=off 时注入覆盖样式，用来在同一份产物里单独评估 content-visibility 的贡献
const cvMode = process.env.PERF_CV || 'default'
if (cvMode === 'off') {
  await evaluate(
    cdp,
    `(() => {
       const s = document.createElement('style')
       s.textContent = '.results .body .row{content-visibility:visible !important;contain-intrinsic-size:none !important}'
       document.head.appendChild(s)
       return getComputedStyle(document.querySelector('.results .row')).contentVisibility
     })()`
  )
}
report.cvMode = cvMode
report.scroll = await evalfile(
  cdp,
  `
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const body = document.querySelector('.results .body')
  if (!body) return { skipped: '找不到滚动容器' }

  const stats = (frames) => {
    const sorted = [...frames].sort((a, b) => a - b)
    const sum = frames.reduce((s, x) => s + x, 0)
    const over33 = frames.filter((x) => x > 33.4).length
    const over50 = frames.filter((x) => x > 50).length
    return {
      frames: frames.length,
      durationMs: Math.round(sum),
      avgFrameMs: frames.length ? Number((sum / frames.length).toFixed(2)) : null,
      p50FrameMs: sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : null,
      p95FrameMs: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : null,
      maxFrameMs: sorted.length ? sorted[sorted.length - 1] : null,
      framesOver33ms: over33,
      framesOver50ms: over50,
      jankPct: frames.length ? Number(((over33 / frames.length) * 100).toFixed(1)) : null
    }
  }

  /** 逐帧滚动：每帧推进 stepRatio 屏，滚到底为止；重复 repeat 次，帧样本汇总 */
  async function runScroll(stepRatio, repeat) {
    const runs = []
    const pooled = []
    for (let r = 0; r < repeat; r += 1) {
      body.scrollTop = 0
      await sleep(220)
      const frames = []
      let last = performance.now()
      let steps = 0
      await new Promise((resolve) => {
        const tick = () => {
          const now = performance.now()
          frames.push(Number((now - last).toFixed(2)))
          last = now
          steps += 1
          const before = body.scrollTop
          body.scrollTop = Math.min(before + body.clientHeight * stepRatio, body.scrollHeight)
          if (steps >= 60 || body.scrollTop === before) return resolve()
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      await sleep(180)
      runs.push(stats(frames))
      pooled.push(...frames)
    }
    return { runs, pooled: stats(pooled) }
  }

  /** 等封面图加载完，避免图片解码混进滚动帧耗时里 */
  async function settleImages(maxMs) {
    const t0 = performance.now()
    for (;;) {
      const imgs = [...document.querySelectorAll('.results .row img')]
      if (imgs.length > 0 && imgs.every((i) => i.complete)) return true
      if (performance.now() - t0 > maxMs) return false
      await sleep(150)
    }
  }

  // 预热：先完整滚一遍（触发懒加载封面 + 建立样式/布局缓存），这一遍不计入结果
  await runScroll(0.8, 1)
  body.scrollTop = 0
  const imagesSettled = await settleImages(6000)

  const a = await runScroll(0.8, 3)
  const b = await runScroll(1.6, 3)
  return {
    imagesSettled,
    visibility: document.visibilityState,
    focused: document.hasFocus(),
    slowScroll: a,
    fastScroll: b,
    scrollHeight: body.scrollHeight,
    clientHeight: body.clientHeight,
    screens: Number((body.scrollHeight / body.clientHeight).toFixed(2)),
    finalScrollTop: Math.round(body.scrollTop)
  }
`
)

/* ---------------- 4. 单次更新的真实成本（DOM 变更时刻 + 强制布局） ---------------- */
step('4 单次更新成本')
/*
 * 注意：不要用 double-rAF 当结束信号 —— 那本身就压着 ~16ms 的测量地板，
 * 会把「27ms」和「16ms」这类真实差距抹平。改为监听 MutationObserver：
 * 回调是 DOM 变更后的微任务，时间戳精确；在回调里立刻读一次 scrollHeight
 * 强制同步布局，于是「Vue 打补丁」和「打补丁 + 样式布局」两个数字都能拿到。
 */
report.rerender = await evalfile(
  cdp,
  `
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const root = document.querySelector('.results')
  const body = document.querySelector('.results .body')

  async function measure(label, trigger) {
    let domAt = 0
    let layoutAt = 0
    let mutations = 0
    const obs = new MutationObserver((records) => {
      if (domAt) { mutations += records.length; return }
      domAt = performance.now()
      mutations = records.length
      void body.scrollHeight
      layoutAt = performance.now()
    })
    obs.observe(root, { childList: true, subtree: true, attributes: true, characterData: true })
    const t0 = performance.now()
    trigger()
    const deadline = t0 + 3000
    while (!domAt && performance.now() < deadline) await sleep(1)
    obs.disconnect()
    return {
      label,
      patchMs: domAt ? Number((domAt - t0).toFixed(2)) : null,
      patchAndLayoutMs: layoutAt ? Number((layoutAt - t0).toFixed(2)) : null,
      mutations
    }
  }

  const btn = [...document.querySelectorAll('.meta-row button')].find(b => b.innerText.includes('多选'))
  if (!btn) return { skipped: '找不到多选按钮' }

  const enter = await measure('进入多选', () => btn.click())
  const boxes = document.querySelectorAll('.results .row .row-check').length

  // 勾第一行：v-memo 生效时只应重画这一行
  const check = document.querySelector('.results .row .row-check')
  const select = await measure('勾选第一行', () => check.click())
  const checked1 = document.querySelectorAll('.results .row .row-check:checked').length

  // 再勾一行（换目标，避免命中缓存造成假象）
  const check2 = document.querySelectorAll('.results .row .row-check')[1]
  const select2 = await measure('勾选第二行', () => check2.click())
  const checked2 = document.querySelectorAll('.results .row .row-check:checked').length

  const exitBtn = [...document.querySelectorAll('.meta-row button')].find(b => b.innerText.includes('退出多选'))
  const exit = await measure('退出多选', () => exitBtn.click())

  return {
    enterSelectMode: enter,
    selectRow1: select,
    selectRow2: select2,
    exitSelectMode: exit,
    checkboxesRendered: boxes,
    checkboxesAfterExit: document.querySelectorAll('.results .row .row-check').length,
    checkedAfterFirst: checked1,
    checkedAfterSecond: checked2
  }
`
)

/* ---------------- 5. 堆占用 ---------------- */
report.memory = await evaluate(
  cdp,
  `(() => { const m = performance.memory; return m ? { usedJSHeapMB: Number((m.usedJSHeapSize / 1048576).toFixed(1)), totalJSHeapMB: Number((m.totalJSHeapSize / 1048576).toFixed(1)) } : null })()`
)

report.dom = await evaluate(cdp, `document.getElementsByTagName('*').length`)

cdp.close()
// 自己写文件（UTF-8）：PowerShell 5.1 的 > 重定向会写成 UTF-16，后面读起来全是乱码
if (process.env.PERF_OUT) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(process.env.PERF_OUT, JSON.stringify(report, null, 2), 'utf8')
}
console.log(JSON.stringify(report, null, 2))
