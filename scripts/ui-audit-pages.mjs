/**
 * 分页面设计审计驱动器（task-8 专用）
 *
 * 为什么需要它：scripts/design-audit.mjs 审的是「当前页面」，而它自带的
 * 路由探测会把 5 个页面串一遍，得到的是混合数字 —— 对「我这一个页面改好了没有」
 * 没有判据价值。这里把它按页面拆开跑，每页单独存一份 JSON，前后可直接对差。
 *
 * 用法：
 *   node scripts/ui-audit-pages.mjs <端口> <profile目录> <路由1,路由2,...> [输出前缀]
 * 例：
 *   node scripts/ui-audit-pages.mjs 9421 F:\MusicHub\.tmp-ui\prof "#/downloads,#/settings" before
 *
 * 注意：design-audit 是 cover-fix 的资产，这里只**调用**它，不改它 ——
 * 前后两次必须用同一把尺子量，才有可比性。
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PORT = Number(process.argv[2] || 9421)
const PROFILE = resolve(process.argv[3] || 'F:\\MusicHub\\.tmp-ui\\prof')
const ROUTES = String(process.argv[4] || '#/downloads,#/settings')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const PREFIX = process.argv[5] || 'audit'
const APP_DIR = resolve(process.argv[6] || 'F:\\MusicHub')
const ELECTRON = resolve(
  process.argv[7] || 'F:\\MusicHub\\node_modules\\electron\\dist\\electron.exe'
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!existsSync(PROFILE)) mkdirSync(PROFILE, { recursive: true })

// 端口预检：连到别人的实例上会得到完全错误的数据（踩过）
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const list = await res.json()
  if (Array.isArray(list) && list.length > 0) {
    console.error(`!! 端口 ${PORT} 已被占用，请换一个空闲端口`)
    process.exit(2)
  }
} catch {
  /* 端口空着才是正常的 */
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`], {
  cwd: APP_DIR,
  env,
  stdio: 'ignore'
})
const rootPid = child.pid

async function pickPage() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const list = await res.json()
  return list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
}

async function connect(url) {
  const ws = new WebSocket(url)
  let seq = 0
  const pending = new Map()
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const { resolve: rs, reject: rj } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? rj(new Error(JSON.stringify(m.error))) : rs(m.result)
    }
  }
  return {
    send: (method, params = {}) =>
      new Promise((rs, rj) => {
        const id = ++seq
        pending.set(id, { resolve: rs, reject: rj })
        ws.send(JSON.stringify({ id, method, params }))
      }),
    close: () => ws.close()
  }
}

const results = {}
let cdp = null
try {
  let page = null
  for (let i = 0; i < 120; i += 1) {
    try {
      page = await pickPage()
      if (page) break
    } catch {
      /* 还没起来 */
    }
    await sleep(500)
  }
  if (!page) throw new Error('应用没起来（CDP 不可达）')

  cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  // 等音源装载与首屏稳定，免得把加载中的中间态当成设计问题
  await sleep(12000)

  for (const route of ROUTES) {
    await cdp.send('Runtime.evaluate', {
      expression: `location.hash = ${JSON.stringify(route)}`,
      awaitPromise: true,
      returnByValue: true
    })
    await sleep(1800)
    const raw = execFileSync(
      process.execPath,
      ['scripts/design-audit.mjs', String(PORT), '--json', '--no-route'],
      { cwd: APP_DIR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    )
    const start = raw.indexOf('{')
    const report = JSON.parse(raw.slice(start))
    results[route] = report
    const t = report.字号
    const c = report.对比度
    const s = report.间距
    const h = report.命中区
    const m = report.动效
    const r = report.圆角
    console.log(
      `${route.padEnd(12)} 元素=${String(report.采样元素数).padStart(4)}  ` +
        `字号=${t.种类}种  对比不达标=${c.不达标数}/${c.检查数}  ` +
        `离网间距=${s.离网总数}/${s.检查数}  圆角=${r.种类}种  ` +
        `<24px命中区=${h.小于24px数量}  时长=${m.时长种类}种  keyframes=${m.keyframes规则数}  reduced-motion=${m.reducedMotion规则数}`
    )
    console.log(`   字号明细: ${t.明细.map((d) => d.value + '×' + d.count).join('  ')}`)
    console.log(`   圆角明细: ${r.明细.map((d) => d.value + '×' + d.count).join('  ')}`)
    console.log(`   离网 Top: ${s.明细.slice(0, 6).map((d) => d.value + '×' + d.count).join('  ')}`)
    console.log(`   动效属性: ${m.属性明细.map((d) => d.value + '×' + d.count).join('  ')}`)
    console.log(`   时长明细: ${m.时长明细.map((d) => d.value + '×' + d.count).join('  ')}`)
    if (h.小于24px数量) {
      console.log(`   <24px 命中区样例: ${h.样例.slice(0, 6).map((x) => x.tag + ' ' + x.size).join(' | ')}`)
    }
    if (c.不达标数) {
      console.log(
        `   对比度不达标样例: ${c.不达标样例.slice(0, 6).map((x) => x.ratio + '<' + x.need + ' ' + x.selector).join(' | ')}`
      )
    }
  }
} catch (err) {
  console.error('审计失败:', err && err.message)
  process.exitCode = 1
} finally {
  if (cdp) cdp.close()
  // 正常关窗（走真实退出路径），再兜底
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
  const still = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${PORT}*' } | Measure-Object).Count`
    ],
    { encoding: 'utf8' }
  ).trim()
  if (Number(still) > 0) {
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
  const file = `F:\\MusicHub\\.tmp-ui\\${PREFIX}.json`
  mkdirSync('F:\\MusicHub\\.tmp-ui', { recursive: true })
  writeFileSync(file, JSON.stringify(results, null, 1), 'utf8')
  console.log(`\n已保存: ${file}`)
}
process.exit(process.exitCode || 0)
