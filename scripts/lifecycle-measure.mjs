/**
 * 主进程生命周期测量器（task-3 专用）
 *
 * 为什么单独写一个：既有的 scripts/cdp.mjs 端口硬编码 9222，而 9222/9223
 * 被渲染层/封面队友占用。这里做三件事：
 *   1. 用指定端口 + 独立 user-data-dir 启动一个完全隔离的实例
 *      （隔离 user-data-dir 才能绕过单实例锁，与队友并存）
 *   2. 采样进程数与各进程内存（WorkingSetSize，与基线口径一致）
 *   3. 用 WM_CLOSE 关窗口（等价用户点右上角 X），量化「几秒归零」
 *
 * 用法：
 *   node scripts/lifecycle-measure.mjs --app <dir> --profile <dir> --port 9224 \
 *        --label before [--probe <file.mjs>] [--selftest 0|1]
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, def = undefined) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : def
}
const flag = (name) => argv.includes(`--${name}`)

const APP_DIR = resolve(arg('app', 'F:\\MusicHub'))
const PROFILE = resolve(arg('profile', 'F:\\MusicHub\\.tmp-lifecycle\\profile'))
const PORT = Number(arg('port', '9224'))
const LABEL = arg('label', 'run')
const PROBE = arg('probe', null)
const ELECTRON = arg('electron', 'F:\\MusicHub\\node_modules\\electron\\dist\\electron.exe')
/**
 * 用可执行文件名来采样进程。
 *
 * 默认是 electron.exe；但这个仓库里大家约定了「重启前 Stop-Process electron」，
 * 那条命令会把正在测量的实例一起杀掉（实测踩到过，settled 采样直接变成 null）。
 * 所以测量时用一个另存副本（如 musichub-lifecycle.exe）就没有这个风险 ——
 * 镜像名不同，别人的清理命令碰不到它。
 */
const IMAGE = basename(ELECTRON)
const SETTLE_MS = Number(arg('settle', '45000'))
const EARLY_MS = Number(arg('early', '12000'))
const OUT = arg('out', null)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------ 进程采样 ------------------------------ */

const PS_SCRIPT =
  'Get-CimInstance Win32_Process -Filter "Name=\'' +
  IMAGE +
  '\'" | Select-Object ProcessId,ParentProcessId,WorkingSetSize,CommandLine | ConvertTo-Json -Compress -Depth 3'

function sampleProcesses() {
  const raw = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], {
    encoding: 'utf8',
    windowsHide: true
  }).trim()
  if (!raw) return []
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed) ? parsed : [parsed]
}

/** 从 rootPid 出发收集整棵进程树 */
function treeOf(all, rootPid) {
  const byParent = new Map()
  for (const p of all) {
    const list = byParent.get(p.ParentProcessId) ?? []
    list.push(p)
    byParent.set(p.ParentProcessId, list)
  }
  const out = []
  const walk = (pid) => {
    for (const child of byParent.get(pid) ?? []) {
      out.push(child)
      walk(child.ProcessId)
    }
  }
  walk(rootPid)
  return out
}

function kindOf(p) {
  const cl = p.CommandLine ?? ''
  if (cl.includes('--type=renderer')) return 'renderer'
  if (cl.includes('--type=gpu-process')) return 'gpu'
  if (cl.includes('--type=utility')) return 'utility'
  if (cl.includes('--type=')) return /--type=([\w-]+)/.exec(cl)[1]
  return 'main'
}

const MB = (bytes) => Math.round((bytes / 1048576) * 10) / 10

function snapshot(rootPid) {
  const all = sampleProcesses()
  const root = all.find((p) => p.ProcessId === rootPid)
  if (!root) return null
  const tree = [root, ...treeOf(all, rootPid)]
  const procs = tree.map((p) => ({
    pid: p.ProcessId,
    kind: kindOf(p),
    mb: MB(p.WorkingSetSize)
  }))
  return {
    count: procs.length,
    totalMB: Math.round(procs.reduce((s, p) => s + p.mb, 0) * 10) / 10,
    procs
  }
}

/* ------------------------------ CDP ------------------------------ */

async function pickPage() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const list = await res.json()
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('找不到渲染进程 target')
  return page
}

function connect(url) {
  return new Promise((resolveConn, reject) => {
    const ws = new WebSocket(url)
    let id = 0
    const pending = new Map()
    ws.addEventListener('open', () =>
      resolveConn({
        send(method, params) {
          return new Promise((res, rej) => {
            const mid = ++id
            pending.set(mid, { res, rej })
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

async function evaluate(cdp, expression, awaitPromise = true) {
  const out = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  })
  if (out.exceptionDetails) {
    const d = out.exceptionDetails
    throw new Error(d.exception?.description ?? d.text ?? '页面内执行异常')
  }
  return out.result?.value
}

/* ------------------------------ 主流程 ------------------------------ */

const report = { label: LABEL, startedAt: new Date().toISOString(), port: PORT, app: APP_DIR }
const before = sampleProcesses().map((p) => p.ProcessId)
report.preexistingElectronPids = before

if (!existsSync(PROFILE)) mkdirSync(PROFILE, { recursive: true })

/**
 * 端口占用预检。
 *
 * 这个仓库里多个队友各占一个 CDP 端口。如果端口已经被别人的实例占着，
 * 本脚本的 CDP 连接会连到**别人**的渲染进程上 —— 探针跑在别人的应用里，
 * 测出来的内存却是自己实例的，数据会完全失真（实测踩过一次：
 * cdpReadyMs 只有 28ms，正常冷启动要 550ms 左右，一眼就是连错了）。
 * 所以宁可直接失败，也不要产出一份看着像样、其实张冠李戴的报告。
 */
try {
  const probe = await fetch(`http://127.0.0.1:${PORT}/json`)
  const list = await probe.json()
  if (Array.isArray(list) && list.length > 0) {
    console.error(
      `!! 端口 ${PORT} 上已经有 CDP 实例（${list.length} 个 target）：那多半是别人的应用。\n` +
        `   请换一个空闲端口，否则探针会跑在别人的进程里。`
    )
    process.exit(2)
  }
} catch {
  /* 连不上才是正常的：说明端口空着 */
}

// 关键：ELECTRON_RUN_AS_NODE 必须清掉，否则 electron.exe 退化成纯 node
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(
  ELECTRON,
  [APP_DIR, `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`],
  { cwd: APP_DIR, env, stdio: 'ignore', detached: false, windowsHide: false }
)
const rootPid = child.pid
report.rootPid = rootPid

try {
  // 1) 等 CDP 就绪
  let page = null
  const t0 = Date.now()
  for (let i = 0; i < 120; i += 1) {
    try {
      page = await pickPage()
      break
    } catch {
      await sleep(500)
    }
  }
  report.cdpReadyMs = Date.now() - t0
  if (!page) throw new Error('CDP 未就绪，应用可能没起来')

  report.windowTitle = page.title

  /**
   * 按固定节拍采样整段启动过程，同时给出「早期」「稳定期」两个点与全程峰值。
   *
   * 为什么要连续采样：音源并行装载会让「同时有几个 vm 沙箱在内存里」随时间变化，
   * 只看两个点的读数会漏掉装载期的瞬时高峰。峰值才是用户真正感受到的内存压力。
   */
  const every = Number(arg('sample-every', '1000'))
  const series = []
  let peak = null
  let early = null
  for (;;) {
    const snap = snapshot(rootPid)
    const at = Date.now() - t0
    if (snap) {
      series.push({ at, count: snap.count, totalMB: snap.totalMB, mainMB: snap.procs.find((p) => p.kind === 'main')?.mb ?? null })
      if (!peak || snap.totalMB > peak.totalMB) peak = { at, ...snap }
      if (!early && at >= EARLY_MS) early = { at, ...snap }
    }
    if (at >= SETTLE_MS) break
    await sleep(every)
  }
  report.series = series
  report.peak = peak
    ? { atMs: peak.at, count: peak.count, totalMB: peak.totalMB, procs: peak.procs }
    : null
  report.early = early
  report.settled = snapshot(rootPid)
  if (report.settled) report.settled.atMs = Date.now() - t0

  // 4) 可选：在渲染层跑探针
  if (PROBE) {
    const cdp = await connect(page.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable')
    const src = readFileSync(PROBE, 'utf8')
    try {
      const value = await evaluate(cdp, `(async () => { ${src} })()`)
      report.probe = value
    } catch (err) {
      report.probeError = err instanceof Error ? err.message : String(err)
    }
    cdp.close()
    // 探针跑完之后再采一次：用于衡量「跑完这批操作之后主进程留下多少内存」
    await sleep(2500)
    report.afterProbe = snapshot(rootPid)
  }

  // 5) 关窗口：WM_CLOSE，等价于点右上角 X
  const closeMode = arg('close', 'wmclose')
  report.closeMode = closeMode
  const tClose = Date.now()
  if (closeMode === 'wmclose') {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-Process -Id ${rootPid}).CloseMainWindow() | Out-Null`
      ],
      { encoding: 'utf8', windowsHide: true }
    )
  } else {
    const cdp = await connect(page.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable')
    // appClose 走的是真实的 win.close()，与点标题栏 X 等价
    await evaluate(cdp, `window.api.app.close()`).catch(() => undefined)
  }

  // 6) 量化归零时间
  const timeline = []
  let zeroAt = null
  const checkpoints = [500, 1000, 3000]
  const residualCurve = {}
  for (let i = 0; i < 200; i += 1) {
    await sleep(100)
    const snap = snapshot(rootPid)
    const elapsed = Date.now() - tClose
    // 按 user-data-dir 过滤的残留数：只算本 profile 的进程，别人实例再多也不计入
    if (checkpoints.length > 0 && elapsed >= checkpoints[0]) {
      const mine = sampleProcesses().filter((p) => (p.CommandLine ?? '').includes(PROFILE.replace(/\//g, '\\')))
      residualCurve[checkpoints[0]] = mine.length
      checkpoints.shift()
    }
    if (!snap) {
      zeroAt = elapsed
      timeline.push({ ms: elapsed, count: 0, totalMB: 0 })
      break
    }
    if (i % 5 === 0) timeline.push({ ms: elapsed, count: snap.count, totalMB: snap.totalMB })
  }
  // 补齐没走到的检查点（进程已归零）
  for (const cp of checkpoints) residualCurve[cp] = 0
  report.residualByProfile = residualCurve
  report.exit = { zeroAfterMs: zeroAt, timeline }
  report.cleanExitUnder3s = zeroAt !== null && zeroAt <= 3000

  // 7) 残留检查：我们的树里还剩谁
  report.leftover = snapshot(rootPid)
} catch (err) {
  report.error = err instanceof Error ? err.message : String(err)
  report.stack = err instanceof Error ? err.stack : undefined
} finally {
  // 无论如何都要收尸，避免留下孤儿进程
  await sleep(1500)
  const still = snapshot(rootPid)
  if (still) {
    report.forcedKill = still.procs.map((p) => p.pid)
    try {
      execFileSync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        still.procs.map((p) => `Stop-Process -Id ${p.pid} -Force -ErrorAction SilentlyContinue`).join('; ')
      ], { encoding: 'utf8', windowsHide: true })
    } catch {
      /* 已经退了 */
    }
  }
  report.finishedAt = new Date().toISOString()
  const text = JSON.stringify(report, null, 2)
  console.log(text)
  if (OUT) writeFileSync(OUT, text, 'utf8')
}

process.exit(0)
