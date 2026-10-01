/**
 * 界面偏好 / 搜索历史：两段式验证驱动器（task-12）
 *
 * 为什么要两段：验收里有一条「**重启后历史仍在**」，单进程内怎么测都是自欺。
 * 所以这里用**同一个 profile** 起两次应用：
 *   第一段：clean → 连续记 3 词 → 去重 → 50 次截断 → 删单条 → 清空 → 设置页选择器切换
 *          → 留下一个已知状态（来源=playlist，历史=两条）
 *          → **进程还活着的时候**由宿主机读 ui-prefs.json，核对防抖是否真的落了盘
 *   第二段：重启 → 核对来源与历史原样读回、设置页选择器显示的就是存的值
 *
 * 用法：node scripts/ui-verify-prefs.mjs <port> <profileDir> <label>
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PORT = Number(process.argv[2] || 9471)
const PROFILE = resolve(process.argv[3] || 'F:\\MusicHub\\.tmp-ui\\prefs-prof')
const LABEL = process.argv[4] || 'prefs'
const APP_DIR = 'F:\\MusicHub\\.tmp-ui\\app'
const CWD = 'F:\\MusicHub'
const OUT_DIR = 'F:\\MusicHub\\.tmp-ui'
const ELECTRON = 'F:\\MusicHub\\node_modules\\electron\\dist\\electron.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync(OUT_DIR, { recursive: true })
const summary = { label: LABEL, startedAt: new Date().toISOString(), phases: {} }

/* ---------- 端口预检 ---------- */
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const list = await res.json()
  if (Array.isArray(list) && list.length > 0) {
    console.error(`!! 端口 ${PORT} 已被占用`)
    process.exit(2)
  }
} catch {
  /* 空着才对 */
}

if (!existsSync(PROFILE)) mkdirSync(PROFILE, { recursive: true })
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

function launch(extraArgs = []) {
  return spawn(
    ELECTRON,
    [
      APP_DIR,
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      // Windows 原生遮挡检测会让 document.hidden=true、rAF 停摆；
      // 本任务不算帧，但保持与其它人一致的启动参数，避免出现「探针莫名失败」
      '--disable-features=CalculateNativeWinOcclusion',
      ...extraArgs
    ],
    { cwd: APP_DIR, env, stdio: 'ignore' }
  )
}

async function waitUp() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      if (list.some((t) => t.type === 'page')) return true
    } catch {
      /* 还没起来 */
    }
    await sleep(500)
  }
  return false
}

function runProbe(probe) {
  try {
    const out = execFileSync(
      process.execPath,
      ['scripts/cdp-run.mjs', String(PORT), probe],
      { cwd: CWD, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180000 }
    )
    return { ok: true, json: safeJson(out), raw: out }
  } catch (err) {
    const raw = String(err.stdout ?? '') + String(err.stderr ?? '')
    return { ok: false, json: safeJson(raw), raw }
  }
}

function safeJson(text) {
  const start = String(text).indexOf('{')
  if (start < 0) return null
  try {
    return JSON.parse(String(text).slice(start, String(text).lastIndexOf('}') + 1))
  } catch {
    return null
  }
}

async function closeApp(child) {
  try {
    execFileSync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Process -Id ${child.pid}).CloseMainWindow() | Out-Null`
    ])
  } catch {
    /* ignore */
  }
  await sleep(2500)
  try {
    execFileSync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${PORT}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
    ])
  } catch {
    /* ignore */
  }
}

const PREFS_FILE = join(PROFILE, 'ui-prefs.json')

/* ============================ 第一段 ============================ */
console.log('[1/2] 第一次启动（写入 + CRUD + 设置页选择器）…')
let child = launch()
if (!(await waitUp())) throw new Error('第一次启动失败：CDP 不可达')
await sleep(20000) // 等音源装载，保证设置页/导航都可用

const p1 = runProbe('scripts/ui-probe-prefs-storage.mjs')
summary.phases.first = p1.json ?? { raw: p1.raw.slice(-800) }
if (p1.json) {
  for (const c of p1.json.checks ?? []) {
    console.log(`   ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  ${JSON.stringify(c.detail)}`)
  }
  console.log(`   合计 ${(p1.json.checks ?? []).length} 项，失败 ${(p1.json.failed ?? []).length}`)
}

// ★ 关键：进程还活着的时候读磁盘，验证「防抖 400ms 之后确实落盘」，
//   而不是靠退出时的 flush 兜底
let disk = null
for (let i = 0; i < 20; i += 1) {
  await sleep(400)
  if (existsSync(PREFS_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(PREFS_FILE, 'utf8'))
      if (parsed.searchEmptySource === 'playlist') {
        disk = parsed
        break
      }
    } catch {
      /* 正在写，重试 */
    }
  }
}
summary.phases.diskWhileRunning = disk
console.log(
  `   运行中磁盘核对: ${disk ? 'PASS' : 'FAIL'}  ${disk ? JSON.stringify({ searchEmptySource: disk.searchEmptySource, searchHistory: disk.searchHistory }) : '（读取超时或内容不符）'}`
)
if (disk) {
  const ok =
    disk.searchEmptySource === 'playlist' &&
    JSON.stringify(disk.searchHistory) === JSON.stringify(['第一阶段乙', '第一阶段甲'])
  console.log(`   磁盘内容与预期一致: ${ok ? 'PASS' : 'FAIL'}`)
}

await closeApp(child)

/* ============================ 第二段 ============================ */
console.log('\n[2/2] 第二次启动（同一 profile，验证重启后仍在）…')
child = launch()
if (!(await waitUp())) throw new Error('第二次启动失败：CDP 不可达')
await sleep(20000)

const p2 = runProbe('scripts/ui-probe-prefs-after-restart.mjs')
summary.phases.second = p2.json ?? { raw: p2.raw.slice(-800) }
if (p2.json) {
  console.log(`   空态来源保留: ${p2.json.steps.sourceKept}  历史保留: ${p2.json.steps.historyKept}`)
  console.log(`   读回: ${JSON.stringify(p2.json.steps.readAfterRestart)}`)
  console.log(`   设置页选择器显示: ${p2.json.steps.selectorValueAfterRestart}（与存储一致: ${p2.json.steps.selectorMatchesStored}）`)
  console.log(`   已还原默认: ${JSON.stringify(p2.json.steps.restoredToDefault)}`)
  console.log(`   → ${p2.json.steps.pass ? 'PASS 重启持久化' : 'FAIL 重启持久化'}`)
}

await closeApp(child)

writeFileSync(join(OUT_DIR, `${LABEL}-prefs.json`), JSON.stringify(summary, null, 1), 'utf8')
console.log(`\n汇总已写: ${join(OUT_DIR, `${LABEL}-prefs.json`)}`)

const allPass =
  (summary.phases.first?.pass === true) &&
  !!summary.phases.diskWhileRunning &&
  summary.phases.second?.steps?.pass === true
console.log(allPass ? '\n全部通过' : '\n有失败项，见上方明细')
process.exit(allPass ? 0 : 1)
