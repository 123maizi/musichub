/**
 * rAF + 可见性守卫（所有基于帧的探针跑之前必须先过这一关）
 *
 * 背景：Windows 判定窗口被遮挡时，Chromium 会把页面标记为 hidden，
 * requestAnimationFrame **完全停摆**。后果：
 *   · Vue <Transition mode="out-in"> 的 leave 动画永不结束 → 路由卡在旧视图
 *     （hash 变了、顶栏标题变了、内容区不动）
 *   · 所有基于 rAF 的测量（帧间隔、入场窗口、交错 A/B）全部失真
 * 判据：600ms 内 rAF 帧数 > 0 且 document.hidden === false。
 *
 * 解决：启动实例时加 --disable-features=CalculateNativeWinOcclusion
 * （PowerShell 的 ShowWindow/SetForegroundWindow 不够，Windows 原生遮挡检测照样判 hidden）
 * 见 scripts/isolated-instance.ps1 的启动参数。
 *
 * 用法：node scripts/perf-cdp.mjs evalfile scripts/perf-raf-guard.mjs
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const sample = await (async () => {
  const frames = []
  const t0 = performance.now()
  let last = t0
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 700) // 兜底：rAF 停摆时别把探针挂死
    const tick = () => {
      const now = performance.now()
      frames.push(Number((now - last).toFixed(2)))
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
  return frames
})()

const hidden = document.hidden
const visibility = document.visibilityState
const ok = !hidden && visibility === 'visible' && sample.length > 0

return {
  ok,
  hidden,
  visibility,
  rafFramesIn600ms: sample.length,
  avgFrameMs: sample.length ? Number((sample.reduce((s, x) => s + x, 0) / sample.length).toFixed(2)) : null,
  deepestGapMs: sample.length ? Math.max(...sample) : null,
  verdict: ok
    ? '窗口可见、rAF 正常 —— 帧类测量可信'
    : '⚠ 窗口不可见或 rAF 停摆 —— 帧类测量（滚动/入场/交错A/B）不可信，请带 --disable-features=CalculateNativeWinOcclusion 重启'
}
