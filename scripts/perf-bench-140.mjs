/**
 * 固定 140 行的确定性基准（UI 改版前后都用它对比，避免上游返回条数浮动影响结论）。
 *
 * 做法：用 limit=200 拉一次真实结果，跨平台按顺序去重后取前 140 条塞进 search store。
 * 数据仍是上游真实返回的歌，只是行数被钉死 —— 这样「挂载 / 勾选 / 滚动」三项数字
 * 在任何时刻跑都可比。
 *
 * 量到的东西：
 *   A. 首次挂载（含 Vue 渲染 + 布局）时间线 + 长任务
 *   B. 隔离网络的重新挂载（离开页面再回来，DOM 从零创建）×3
 *   C. 勾选一行 / 进多选模式的 patch 与 patch+布局耗时
 *   D. 滚动整表 3+3 遍的帧间隔分布
 *   E. DOM 节点数
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const search = store('search')

const TARGET = 140

/* ---------------- 环境守卫：窗口不可见 / rAF 停摆时，帧类数字全部不可信 ----------------
   来自 Lead 的排查结论：Windows 判定窗口被遮挡 → document.hidden=true →
   requestAnimationFrame 完全停摆 → 滚动/入场/交错 A/B 全部失真，
   连 Vue <Transition mode="out-in"> 都会卡在旧视图（hash 变了内容不动）。
   启动参数必须带 --disable-features=CalculateNativeWinOcclusion
   （见 scripts/isolated-instance.ps1；PowerShell 的 SetForegroundWindow 不够）。 */
const envFrames = []
{
  const t0 = performance.now()
  let last = t0
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 700)
    const tick = () => {
      const now = performance.now()
      envFrames.push(Number((now - last).toFixed(2)))
      last = now
      if (now - t0 >= 600) {
        clearTimeout(timer)
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}
const env = {
  hidden: document.hidden,
  visibility: document.visibilityState,
  rafFramesIn600ms: envFrames.length,
  rafAvgFrameMs: envFrames.length
    ? Number((envFrames.reduce((s, x) => s + x, 0) / envFrames.length).toFixed(2))
    : null,
  frameMetricsTrustworthy: !document.hidden && document.visibilityState === 'visible' && envFrames.length > 0
}

/* ---------------- 准备固定 140 行 ---------------- */
window.location.hash = '#/search'
// 路由过渡是 out-in，必须等搜索页真的挂上再继续（固定 sleep 会撞过渡窗口）
for (let i = 0; i < 100; i += 1) {
  if ($('.search-box input')) break
  await sleep(80)
}
const res = await window.api.search.search({ keyword: '周杰伦', limit: 200 })
const seen = new Set()
const merged = []
for (const group of res.platforms ?? []) {
  for (const song of group.songs ?? []) {
    if (seen.has(song.id)) continue
    seen.add(song.id)
    merged.push(song)
  }
}
const slice = merged.slice(0, TARGET)
search.activePlatform = 'all'
search.keyword = '周杰伦'
search.platforms = [{ platform: 'kw', providerName: 'bench', songs: slice, error: null }]

/* ---------------- 工具 ---------------- */
function installObservers() {
  const state = { timeline: [], longTasks: [], t0: performance.now() }
  state.po = new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      state.longTasks.push({ atMs: Number((e.startTime - state.t0).toFixed(1)), dur: Number(e.duration.toFixed(1)) })
    }
  })
  state.po.observe({ entryTypes: ['longtask'] })
  state.obs = new MutationObserver(() => {
    const n = $$('.results .row').length
    if (n !== (state.timeline[state.timeline.length - 1]?.n ?? -1)) {
      state.timeline.push({ atMs: Number((performance.now() - state.t0).toFixed(1)), n })
    }
  })
  state.obs.observe(document.body, { childList: true, subtree: true })
  return state
}
function stopObservers(state) {
  state.obs.disconnect()
  state.po.disconnect()
  return {
    timeline: state.timeline,
    longTasks: state.longTasks,
    longTaskCount: state.longTasks.length,
    longTaskMaxMs: state.longTasks.length ? Math.max(...state.longTasks.map((t) => t.dur)) : 0
  }
}
async function waitFullRows(timeout = 15000) {
  const t0 = performance.now()
  for (;;) {
    if ($$('.results .row').length === TARGET) return true
    if (performance.now() - t0 > timeout) return false
    await sleep(40)
  }
}

/**
 * 采样一段帧间隔。
 *
 * 动效强度提上去以后（错峰入场 + 360ms 过渡），风险不再是「挂载那一下有没有长任务」，
 * 而是「入场这 600~700ms 里掉不掉帧」。所以基准里单独采这一段：
 * 从列表开始挂载起采 900ms，报告平均/p95/最大帧间隔与 >33ms 的卡顿帧数。
 */
function sampleFrames(durationMs) {
  const frames = []
  const t0 = performance.now()
  let last = t0
  return new Promise((resolve) => {
    const tick = () => {
      const now = performance.now()
      frames.push(Number((now - last).toFixed(2)))
      last = now
      if (now - t0 >= durationMs) return resolve(frames)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}
function frameStats(frames) {
  const sorted = [...frames].sort((a, b) => a - b)
  const sum = frames.reduce((s, x) => s + x, 0)
  return {
    frames: frames.length,
    avgFrameMs: frames.length ? Number((sum / frames.length).toFixed(2)) : null,
    p50: sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : null,
    p95: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : null,
    max: sorted.length ? sorted[sorted.length - 1] : null,
    over33: frames.filter((x) => x > 33.4).length,
    over50: frames.filter((x) => x > 50).length
  }
}

/* ---------------- A. 首次挂载（含入场动画窗口的帧采样） ---------------- */
const A = installObservers()
const firstEntryFrames = sampleFrames(900)
await waitFullRows()
const firstSettledMs = Number((performance.now() - A.t0).toFixed(1))
await sleep(400)
const firstMount = stopObservers(A)
const firstEntry = frameStats(await firstEntryFrames)
const domNodes = document.getElementsByTagName('*').length

/* ---------------- B. 隔离网络的重新挂载 ×3（同样含入场帧采样） ---------------- */
const remounts = []
for (let i = 0; i < 3; i += 1) {
  window.location.hash = '#/library'
  await sleep(650)
  const st = installObservers()
  window.location.hash = '#/search'
  const entryFrames = sampleFrames(900)
  await waitFullRows()
  const settledMs = Number((performance.now() - st.t0).toFixed(1))
  await sleep(300)
  const stopped = stopObservers(st)
  remounts.push({ ...stopped, settledMs, entry: frameStats(await entryFrames) })
  await sleep(200)
}

/* ---------------- C. 单次更新成本 ---------------- */
const rerender = await (async () => {
  const root = $('.results')
  const body = $('.results .body')
  async function measure(trigger) {
    let domAt = 0
    let layoutAt = 0
    let mutations = 0
    const obs = new MutationObserver((records) => {
      if (domAt) {
        mutations += records.length
        return
      }
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
    return { patchMs: Number((domAt - t0).toFixed(2)), patchAndLayoutMs: Number((layoutAt - t0).toFixed(2)), mutations }
  }
  // 多选按钮改版后在外壳顶栏的 #page-actions 里，按文案全局找
  const findBtn = (text) => $$('button').find((b) => b.innerText.includes(text))
  const btn = findBtn('多选')
  if (!btn) return { skipped: '找不到多选按钮' }
  const enter = await measure(() => btn.click())
  const boxes = $$('.results .row .row-check').length
  const s1 = await measure(() => $$('.results .row .row-check')[1].click())
  const s2 = await measure(() => $$('.results .row .row-check')[2].click())
  const exitBtn = findBtn('退出多选')
  const exit = await measure(() => exitBtn.click())
  return { enterSelectMode: enter, selectRow1: s1, selectRow2: s2, exitSelectMode: exit, checkboxesRendered: boxes }
})()

/* ---------------- D. 滚动帧 ---------------- */
const scroll = await (async () => {
  const body = $('.results .body')
  const stats = (frames) => {
    const sorted = [...frames].sort((a, b) => a - b)
    const sum = frames.reduce((s, x) => s + x, 0)
    const over33 = frames.filter((x) => x > 33.4).length
    return {
      frames: frames.length,
      avgFrameMs: frames.length ? Number((sum / frames.length).toFixed(2)) : null,
      p50: sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : null,
      p95: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : null,
      max: sorted.length ? sorted[sorted.length - 1] : null,
      over33
    }
  }
  async function pass(stepRatio) {
    body.scrollTop = 0
    await sleep(200)
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
    await sleep(160)
    return frames
  }
  // 预热一遍并等封面加载
  await pass(0.8)
  body.scrollTop = 0
  const t0 = performance.now()
  while (performance.now() - t0 < 6000) {
    const imgs = $$('.results .row img')
    if (imgs.length > 0 && imgs.every((i) => i.complete)) break
    await sleep(150)
  }
  const pooledSlow = []
  const pooledFast = []
  for (let i = 0; i < 3; i += 1) pooledSlow.push(...(await pass(0.8)))
  for (let i = 0; i < 3; i += 1) pooledFast.push(...(await pass(1.6)))
  return { slow: stats(pooledSlow), fast: stats(pooledFast), screens: Number((body.scrollHeight / body.clientHeight).toFixed(2)) }
})()

return {
  target: TARGET,
  rowCount: $$('.results .row').length,
  storeSongs: search.visibleSongs.length,
  upstreamCounts: (res.platforms ?? []).map((p) => `${p.platform}:${p.songs?.length ?? 0}`),
  env,
  domNodes,
  domPerRow: Number((domNodes / TARGET).toFixed(2)),
  firstMount: { ...firstMount, settledMs: firstSettledMs, entry: firstEntry },
  remounts: remounts.map((r) => ({
    timeline: r.timeline,
    longTaskCount: r.longTaskCount,
    longTaskMaxMs: r.longTaskMaxMs,
    settledMs: r.settledMs,
    entry: r.entry
  })),
  rerender,
  scroll
}
