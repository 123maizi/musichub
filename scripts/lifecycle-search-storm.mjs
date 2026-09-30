/**
 * 搜索请求风暴验证（task-3 追加项）
 *
 * 要回答的问题：同时发 N 个**完全相同**的搜索，主进程到底向平台发了几次请求？
 *
 * 为什么在宿主机上数 TCP 连接而不是数日志：
 *   日志只在失败时才有记录。并发去重生效时平台根本没被打爆，日志是一片安静 ——
 *   拿安静当证据是循环论证。TCP 连接是进程级事实：
 *   HTTP/1.1 下 N 个并发请求不可能共用一条连接，所以「窗口内出现过的
 *   不同连接数」就是「真实上游请求数」的直接代理，且不依赖任何一方的日志。
 *
 * 每个场景都用一个全新的关键词（跨进程缓存是空的，进程内各场景关键词互不相同），
 * 确保测到的是真实请求而不是缓存命中。
 *
 * 用法：
 *   node scripts/lifecycle-search-storm.mjs --app <dir> --profile <dir> --port <空闲端口> --label <x>
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (n, d = undefined) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : d
}
const APP_DIR = resolve(arg('app', 'F:\\MusicHub\\.tmp-lifecycle\\app'))
const PROFILE = resolve(arg('profile', 'F:\\MusicHub\\.tmp-lifecycle\\profile-storm'))
const PORT = Number(arg('port', '9414'))
const LABEL = arg('label', 'storm')
const ELECTRON = arg('electron', 'F:\\MusicHub\\node_modules\\electron\\dist\\musichub-lifecycle.exe')
const OUT = arg('out', null)
const IMAGE = basename(ELECTRON)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MB = (b) => Math.round((b / 1048576) * 10) / 10

/* ------------------------------ 进程 / 连接采样 ------------------------------ */

function psJson(script) {
  const raw = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true
  }).trim()
  if (!raw) return []
  const p = JSON.parse(raw)
  return Array.isArray(p) ? p : [p]
}

function procs() {
  return psJson(
    'Get-CimInstance Win32_Process -Filter "Name=\'' +
      IMAGE +
      '\'" | Select-Object ProcessId,ParentProcessId,WorkingSetSize,CommandLine | ConvertTo-Json -Compress -Depth 3'
  )
}

function connections(pid) {
  return psJson(
    `Get-NetTCPConnection -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object State,LocalAddress,LocalPort,RemoteAddress,RemotePort | ConvertTo-Json -Compress -Depth 3`
  )
}

/** 远端（非回环）连接快照：key = 远端地址:端口 ← 本地端口 */
function remoteConns(pid) {
  const out = []
  for (const c of connections(pid)) {
    const ra = String(c.RemoteAddress ?? '')
    if (!ra || ra === '0.0.0.0' || ra === '::' || ra.startsWith('127.') || ra === '::1') continue
    out.push({
      key: `${ra}:${c.RemotePort}<-${c.LocalPort}`,
      host: ra,
      localPort: c.LocalPort,
      state: c.State
    })
  }
  return out
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
  return new Promise((res0, rej) => {
    const ws = new WebSocket(url)
    let id = 0
    const pending = new Map()
    ws.addEventListener('open', () =>
      res0({
        send(method, params) {
          return new Promise((res, rej2) => {
            const mid = ++id
            pending.set(mid, { res, rej: rej2 })
            ws.send(JSON.stringify({ id: mid, method, params }))
          })
        },
        close: () => ws.close()
      })
    )
    ws.addEventListener('error', () => rej(new Error('WS 连接失败')))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej: rj } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) rj(new Error(JSON.stringify(msg.error)))
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

/* ------------------------------ 主流程 ------------------------------ */

const report = { label: LABEL, app: APP_DIR, port: PORT, scenarios: [] }

/* 端口预检：连到别人的实例上会得到完全错误的数据 */
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const list = await res.json()
  if (Array.isArray(list) && list.length > 0) {
    console.error(`!! 端口 ${PORT} 已被占用，请换空闲端口`)
    process.exit(2)
  }
} catch {
  /* 端口空着 */
}

if (!existsSync(PROFILE)) mkdirSync(PROFILE, { recursive: true })
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(
  ELECTRON,
  [APP_DIR, `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`],
  { cwd: APP_DIR, env, stdio: 'ignore' }
)
const rootPid = child.pid
report.rootPid = rootPid

let cdp = null
try {
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
  if (!page) throw new Error('CDP 未就绪')

  cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')

  // 内置搜索不依赖音源，等窗口稳下来就够；顺带等上一次的 keep-alive 连接自然关闭
  await sleep(9000)

  const scenarios = [
    { name: '6并发·单平台(kw)', n: 6, keyword: '周杰伦', platforms: ['kw'] },
    { name: '6并发·全平台', n: 6, keyword: '林俊杰', platforms: null },
    { name: '24并发·全平台(风暴)', n: 24, keyword: '陈奕迅', platforms: null }
  ]

  for (const sc of scenarios) {
    const before = remoteConns(rootPid)
    const samples = []
    let stop = false
    const sampler = (async () => {
      while (!stop) {
        samples.push(remoteConns(rootPid))
        await sleep(60)
      }
    })()

    const expression = `(async () => {
      const req = { keyword: ${JSON.stringify(sc.keyword)}, limit: 30${
        sc.platforms ? `, platforms: ${JSON.stringify(sc.platforms)}` : ''
      } }
      const t0 = performance.now()
      const all = await Promise.all(Array.from({ length: ${sc.n} }, () => window.api.search.search(req)))
      return {
        n: all.length,
        elapsedMs: Math.round(performance.now() - t0),
        costs: all.map((r) => r.cost),
        distinctCosts: new Set(all.map((r) => r.cost)).size,
        perPlatform: all[0].platforms.map((p) => p.platform + '=' + ((p.songs || []).length)),
        errors: all[0].platforms.filter((p) => p.error).map((p) => p.platform + ': ' + p.error)
      }
    })()`

    let probe = null
    let probeError = null
    try {
      probe = await evaluate(cdp, expression)
    } catch (err) {
      probeError = String(err && err.message)
    }
    stop = true
    await sampler

    // 窗口内出现过的所有不同连接 = 真实上游请求数的直接代理
    const seen = new Map()
    let peak = 0
    for (const snap of samples) {
      peak = Math.max(peak, snap.length)
      for (const c of snap) if (!seen.has(c.key)) seen.set(c.key, c)
    }
    const byHost = {}
    for (const c of seen.values()) byHost[c.host] = (byHost[c.host] ?? 0) + 1

    report.scenarios.push({
      ...sc,
      baselineConnections: before.length,
      peakConcurrentRemote: peak,
      distinctConnectionsDuringWindow: seen.size,
      distinctByHost: byHost,
      probe,
      probeError,
      samples: samples.length
    })
    console.log(
      `[${sc.name}] 上游新连接=${seen.size} 峰值并发=${peak} 不同 cost 数=${probe?.distinctCosts ?? '-'} 用时=${probe?.elapsedMs ?? '-'}ms`
    )
    await sleep(6000) // 让 keep-alive 连接自然关闭，免得污染下一个场景
  }

  report.exit = null
  const tClose = Date.now()
  execFileSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `(Get-Process -Id ${rootPid}).CloseMainWindow() | Out-Null`
  ])
  for (let i = 0; i < 60; i += 1) {
    await sleep(100)
    const still = procs().some((p) => p.ProcessId === rootPid)
    if (!still) {
      report.exit = { zeroAfterMs: Date.now() - tClose }
      break
    }
  }
} catch (err) {
  report.error = String(err && err.stack ? err.stack : err)
} finally {
  if (cdp) cdp.close()
  await sleep(1200)
  const left = procs()
  const tree = left.filter((p) => p.ProcessId === rootPid || isDescendant(left, p, rootPid))
  if (tree.length > 0) {
    try {
      execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        tree.map((p) => `Stop-Process -Id ${p.ProcessId} -Force -ErrorAction SilentlyContinue`).join('; ')
      ])
    } catch {
      /* ignore */
    }
  }
  report.leftoverKilled = tree.map((p) => p.ProcessId)
  const text = JSON.stringify(report, null, 2)
  console.log(text)
  if (OUT) writeFileSync(OUT, text, 'utf8')
}

function isDescendant(all, proc, root) {
  let cur = proc
  for (let i = 0; i < 10; i += 1) {
    const parent = all.find((p) => p.ProcessId === cur.ParentProcessId)
    if (!parent) return false
    if (parent.ProcessId === root) return true
    cur = parent
  }
  return false
}

process.exit(0)
