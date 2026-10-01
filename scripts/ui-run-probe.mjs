/**
 * 单探针快速驱动器（task-8 调试用）
 *
 * ui-verify-round.mjs 一次跑全套要 8~10 分钟，调试探针时太慢。
 * 这个只做：起应用 → 等音源 → 跑一个探针 → 打印 JSON → 关应用。
 *
 * 用法：node scripts/ui-run-probe.mjs <port> <profileDir> <探针文件> [等音源秒数]
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PORT = Number(process.argv[2] || 9432)
const PROFILE = resolve(process.argv[3] || 'F:\\MusicHub\\.tmp-ui\\probe')
const PROBE = process.argv[4]
const WAIT_S = Number(process.argv[5] || 25)
if (!PROBE) {
  console.error('用法: node scripts/ui-run-probe.mjs <port> <profileDir> <探针文件> [等音源秒数]')
  process.exit(2)
}

/**
 * 从**快照副本**启动，而不是直接从项目目录启动。
 *
 * 为什么必须这样：页面是懒加载的，别人一构建，chunk 文件名的哈希就变了，
 * 正在跑的实例 `index.html` 里记的还是旧名字 → 懒加载 404 → **路由不切换、
 * 但 hash 变了**。表现出来是「明明导航到 #/downloads，DOM 里却是搜索页」，
 * 拿这种实例量出来的下载页数字全是假的（我这一轮就踩了）。
 * 快照到独立目录后，队友再怎么构建都动不到我这一份。
 */
const APP_DIR = resolve(process.argv[6] || 'F:\\MusicHub\\.tmp-ui\\app')
/** 脚本本身仍在项目里跑（快照目录只有打包产物，没有 scripts/） */
const CWD = 'F:\\MusicHub'
const ELECTRON = 'F:\\MusicHub\\node_modules\\electron\\dist\\electron.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

const child = spawn(
  ELECTRON,
  [APP_DIR, `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`],
  { cwd: APP_DIR, env, stdio: 'ignore' }
)
const rootPid = child.pid

let out = { ok: false }
try {
  let up = false
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      if (list.some((t) => t.type === 'page')) {
        up = true
        break
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(500)
  }
  if (!up) throw new Error('应用没起来')

  console.log(`等 ${WAIT_S}s（音源装载 + 首屏稳定）…`)
  await sleep(WAIT_S * 1000)

  /* ---------- 环境自检：运行中的入口 chunk 必须与产物 index.html 一致 ---------- */
  try {
    const envRaw = execFileSync(
      process.execPath,
      ['scripts/cdp-run.mjs', String(PORT), 'scripts/ui-env-check.mjs'],
      { cwd: CWD, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60000 }
    )
    const env = JSON.parse(envRaw.slice(envRaw.indexOf('{')))
    const htmlPath = join(APP_DIR, 'out', 'renderer', 'index.html')
    const html = readFileSync(htmlPath, 'utf8')
    const refs = [...html.matchAll(/assets\/([A-Za-z0-9_-]+\.js)/g)].map((m) => m[1])
    const entry = env.steps.entryScripts ?? []
    const consistent = refs.length > 0 && entry.some((e) => refs.includes(e))
    console.log(
      `[环境自检] 运行中入口=${entry.join(',') || '(无)'} | 产物 index.html 引用=${refs.join(',') || '(无)'}`
    )
    console.log(
      consistent
        ? '           → 一致 ✓（测的就是这一份构建）'
        : '           → ✗ 不一致！多半连到了旧实例/旧构建（单实例锁会让新进程直接退出、旧进程继续服务）。下面的结论先别信。'
    )
    console.log(
      `[环境自检] 外壳已渲染=${env.steps.hasShell} 顶栏标题=${env.steps.topbarTitle} 已加载 chunk 数=${(env.steps.loadedChunks ?? []).length}`
    )
    if (!consistent) process.exitCode = 3
  } catch (err) {
    console.log(`[环境自检] 跳过（${String(err.message).slice(0, 80)}）`)
  }

  const r = execFileSync(
    process.execPath,
    ['scripts/cdp-run.mjs', String(PORT), PROBE],
    { cwd: CWD, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300000 }
  )
  console.log(r)
  out = { ok: true, raw: r }
} catch (err) {
  console.error('探针失败:')
  console.error(String(err.stdout ?? '') + String(err.stderr ?? '') + String(err.message ?? ''))
  process.exitCode = 1
} finally {
  try {
    execFileSync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Process -Id ${rootPid}).CloseMainWindow() | Out-Null`
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
process.exit(process.exitCode || 0)
