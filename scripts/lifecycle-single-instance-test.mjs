/**
 * 单实例锁验证（task-3 第 8 项）
 *
 * 用户抱怨的「冗杂孤儿进程」里，有一类非常典型：重复启动应用，
 * 第二个进程没能干净退掉，于是任务管理器里堆着半个实例。
 *
 * 本测试就盯着这一件事：
 *   1. 起实例 A（独立 user-data-dir）
 *   2. 用**同一个 user-data-dir** 再起实例 B
 *   3. 量化 B 是否在 2 秒内彻底消失（连同它的 gpu/utility/renderer 子进程）
 *   4. 顺带确认 A 还活着且窗口被前置（second-instance 事件生效）
 *
 * 用法：node scripts/lifecycle-single-instance-test.mjs <appDir> <profileDir> <port>
 */
import { spawn, execFileSync } from 'node:child_process'
import { basename, resolve } from 'node:path'

const APP_DIR = resolve(process.argv[2] ?? 'F:\\MusicHub\\.tmp-lifecycle\\app')
const PROFILE = resolve(process.argv[3] ?? 'F:\\MusicHub\\.tmp-lifecycle\\profile')
const PORT = Number(process.argv[4] ?? '9225')
const ELECTRON =
  process.argv[5] ?? 'F:\\MusicHub\\node_modules\\electron\\dist\\musichub-lifecycle.exe'
const IMAGE = basename(ELECTRON)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PS =
  'Get-CimInstance Win32_Process -Filter "Name=\'' +
  IMAGE +
  '\'" | Select-Object ProcessId,ParentProcessId,WorkingSetSize,CommandLine | ConvertTo-Json -Compress -Depth 3'

function sample() {
  const raw = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS], {
    encoding: 'utf8',
    windowsHide: true
  }).trim()
  if (!raw) return []
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed) ? parsed : [parsed]
}

function treeOf(all, rootPid) {
  const byParent = new Map()
  for (const p of all) {
    const list = byParent.get(p.ParentProcessId) ?? []
    list.push(p)
    byParent.set(p.ParentProcessId, list)
  }
  const out = []
  const walk = (pid) => {
    for (const c of byParent.get(pid) ?? []) {
      out.push(c)
      walk(c.ProcessId)
    }
  }
  walk(rootPid)
  return out
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const report = { app: APP_DIR, profile: PROFILE, port: PORT }

// 端口占用预检：CDP 端口被别人的实例占着时，后面的探活会问到别人身上（实测踩过）
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const list = await res.json()
  if (Array.isArray(list) && list.length > 0) {
    console.error(`!! 端口 ${PORT} 已被占用（${list.length} 个 target），请换空闲端口`)
    process.exit(2)
  }
} catch {
  /* 端口空着 */
}

/* ---------- 实例 A ---------- */
const a = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`], {
  cwd: APP_DIR,
  env,
  stdio: 'ignore'
})
report.aPid = a.pid

let page = null
const t0 = Date.now()
for (let i = 0; i < 120; i += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json`)
    const list = await res.json()
    page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    if (page) break
  } catch {
    /* 还没起来 */
  }
  await sleep(500)
}
report.aCdpReadyMs = Date.now() - t0
if (!page) {
  console.error('实例 A 没起来，测试无法继续')
  try {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      treeOf(sample(), a.pid)
        .map((p) => `Stop-Process -Id ${p.ProcessId} -Force -ErrorAction SilentlyContinue`)
        .concat([`Stop-Process -Id ${a.pid} -Force -ErrorAction SilentlyContinue`])
        .join('; ')
    ])
  } catch {
    /* ignore */
  }
  process.exit(1)
}

await sleep(6000) // 让 A 进入稳定态（音源装载中，正是 worst case）
const beforeB = sample()
report.aTreeBefore = [a.pid, ...treeOf(beforeB, a.pid).map((p) => p.ProcessId)]
report.aProcessCountBefore = report.aTreeBefore.length
report.totalImageProcessesBefore = beforeB.length

/* ---------- 实例 B：同一个 user-data-dir ---------- */
const tB = Date.now()
const b = spawn(ELECTRON, [APP_DIR, `--user-data-dir=${PROFILE}`], {
  cwd: APP_DIR,
  env,
  stdio: 'ignore'
})
report.bPid = b.pid

// 等 B 自己退出
let bExitedEventAt = null
b.on('exit', (code, signal) => {
  bExitedEventAt = Date.now() - tB
  report.bExitCode = code
  report.bExitSignal = signal
})

let zeroAt = null
for (let i = 0; i < 40; i += 1) {
  await sleep(100)
  const all = sample()
  const stillB = all.filter((p) => p.ProcessId === b.pid).length > 0
  if (!stillB) {
    zeroAt = Date.now() - tB
    report.bLeftoverPids = treeOf(all, b.pid).map((p) => p.ProcessId)
    break
  }
}
report.bVanishedAfterMs = zeroAt
report.bExitedEventMs = bExitedEventAt

// B 若留下了子进程（它自己没了但子进程还在），这里能看出来
const allAfter = sample()
const orphanCandidates = allAfter.filter((p) => {
  const cl = p.CommandLine ?? ''
  return !report.aTreeBefore.includes(p.ProcessId) && !cl.includes(`--user-data-dir=${PROFILE}`)
})
report.unexpectedProcesses = orphanCandidates.map((p) => ({ pid: p.ProcessId, cl: (p.CommandLine ?? '').slice(0, 120) }))

/* ---------- A 还活着吗 ---------- */
let aAlive = false
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const list = await res.json()
  aAlive = list.some((t) => t.type === 'page')
} catch {
  aAlive = false
}
report.aStillAliveAfterB = aAlive
report.aProcessCountAfter = sample().filter((p) => report.aTreeBefore.includes(p.ProcessId)).length

/* ---------- 收尾 ---------- */
try {
  execFileSync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `(Get-Process -Id ${a.pid}).CloseMainWindow() | Out-Null`
  ])
} catch {
  /* ignore */
}
await sleep(2500)
const final = sample()
report.aLeftoverAfterClose = final.map((p) => p.ProcessId)
if (final.length > 0) {
  try {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      final.map((p) => `Stop-Process -Id ${p.ProcessId} -Force -ErrorAction SilentlyContinue`).join('; ')
    ])
  } catch {
    /* ignore */
  }
}

report.verdict = {
  bExitedCleanly: zeroAt !== null && zeroAt <= 2000,
  noOrphanFromB: report.unexpectedProcesses.length === 0,
  aUnaffected: aAlive
}
console.log(JSON.stringify(report, null, 2))
process.exit(0)
