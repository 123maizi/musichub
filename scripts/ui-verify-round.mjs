/**
 * 单端口「一轮验证」驱动器（task-8 专用）
 *
 * 一次启动把该跑的全跑完，按固定顺序，避免「手工点了几下就宣布通过」：
 *   1. acceptance.mjs <port>          —— 11 项端到端验收（含下载落盘、设置读写）
 *   2. cdp-run <port> lifecycle-probe-func.mjs —— 我上一轮留下的 15 项功能回归
 *   3. cdp-run <port> ui-probe-format-picker.mjs —— 格式选择器行为三连
 *      （含宿主机侧核对 download-config.json 是否真的落盘）
 *   4. cdp-run <port> ui-probe-progress-frames.mjs —— 进度条帧数据（25s 真实下载）
 *   5. cdp-run <port> ui-probe-build-states.mjs → 宿主删文件 → ui-probe-materialize-missing.mjs
 *      —— 四种任务行状态 + 「填充条不许再有内联 width」判据
 *   6. design-audit --json --no-route（#/downloads 带 4 种状态行、#/settings）
 *
 * 用法：node scripts/ui-verify-round.mjs <port> <profileDir> <label>
 * 说明：应用由本脚本自己拉起与关闭；下载目录一律指向隔离 profile 内，绝不碰用户目录。
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PORT = Number(process.argv[2] || 9431)
const PROFILE = resolve(process.argv[3] || 'F:\\MusicHub\\.tmp-ui\\verify')
const LABEL = process.argv[4] || 'round'
/**
 * 从**快照副本**启动，而不是项目目录。
 *
 * 队友一构建，懒加载 chunk 的文件名哈希就变了；正在跑的实例里 index.html
 * 记的还是旧名字 → `import()` 404 → **hash 变了但视图不切换**。
 * 于是我第一轮就量出了「#/downloads 上 DOM 里是搜索页」这种假数据。
 * 快照之后，队友再怎么构建都动不到这一次验证。
 */
const APP_DIR = 'F:\\MusicHub\\.tmp-ui\\app'
const CWD = 'F:\\MusicHub'
const OUT_DIR = 'F:\\MusicHub\\.tmp-ui'
const ELECTRON = 'F:\\MusicHub\\node_modules\\electron\\dist\\electron.exe'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------- 0. 重建 + 快照（保证测的是当前源码，且中途不被打断） ---------- */
console.log('[0/7] 重建 + 快照到独立目录…')
{
  const b = execFileSync(process.execPath, ['scripts/build-lock.mjs', 'main-lifecycle'], {
    cwd: CWD,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  })
  console.log('      ' + String(b).trim().split('\n').slice(-1)[0])
  const s = execFileSync(process.execPath, ['scripts/ui-snapshot-app.mjs'], {
    cwd: CWD,
    encoding: 'utf8'
  })
  console.log('      ' + String(s).trim().split('\n')[0])
}

mkdirSync(OUT_DIR, { recursive: true })

const summary = { label: LABEL, port: PORT, startedAt: new Date().toISOString(), steps: {} }

function runNode(args, timeoutMs = 300000) {
  try {
    const out = execFileSync(process.execPath, args, {
      cwd: CWD,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs
    })
    return { ok: true, out }
  } catch (err) {
    return {
      ok: false,
      out: String(err.stdout ?? '') + String(err.stderr ?? ''),
      code: err.status ?? null
    }
  }
}

function tail(text, lines = 14) {
  const arr = String(text).trim().split('\n')
  return arr.slice(-lines).join('\n')
}

/* ---------- 端口预检 ---------- */
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const list = await res.json()
  if (Array.isArray(list) && list.length > 0) {
    console.error(`!! 端口 ${PORT} 已被占用，请换空闲端口`)
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
summary.rootPid = rootPid

/* ---------- CDP（用来切路由） ---------- */
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

let cdp = null
try {
  let page = null
  for (let i = 0; i < 120; i += 1) {
    try {
      page = await pickPage()
      if (page) break
    } catch {
      /* 等着 */
    }
    await sleep(500)
  }
  if (!page) throw new Error('应用没起来')
  cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  /**
   * 视图身份断言：hash 变了不等于视图换了。
   * 懒加载 chunk 失效/缺失时 hash 会照常更新，DOM 却停在上一页 —— 不先验一下，
   * 后面量到的每一个数字都可能是别的页面的（我因此报过一整轮假数据）。
   * 失败时重试一次导航；仍失败就抛，宁可整轮失败也不产出假数字。
   */
  const VIEW_MARKERS = {
    '#/downloads': ['下载格式'],
    '#/settings': ['AI 歌词翻译', '下载目录'],
    '#/search': ['下载格式', '输入关键词开始']
  }
  /** hash → 导航柱标签（走用户真实路径） */
  const RAIL_LABEL = {
    '#/search': '搜索',
    '#/downloads': '下载',
    '#/settings': '设置',
    '#/sources': '音源',
    '#/library': '我的'
  }

  /** 读当前页面的「身份特征」：hash 变了不等于视图换了 */
  const probeView = async (route) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const text = document.body.innerText || ''
        const markers = ${JSON.stringify(VIEW_MARKERS[route] ?? [])}
        const hit = markers.filter((m) => text.includes(m))
        return JSON.stringify({ hash: location.hash, hit: hit, ok: hit.length > 0, head: text.replace(/\\s+/g, ' ').slice(0, 70) })
      })()`,
      awaitPromise: true,
      returnByValue: true
    })
    try {
      return JSON.parse(r.result.value)
    } catch {
      return { hash: '?', hit: [], ok: false, head: '' }
    }
  }
  /**
   * 导航一律点左侧导航柱。
   *
   * 实测：`location.hash = '#/xxx'` 在这个外壳里不可靠 —— hash 会变、顶栏标题也会
   * 跟着变（说明路由状态更新了），但 `main` 里的视图常常不换；而点 `.nav-item`
   * 走 `router.push` 每次都成功（600ms 内新视图就进场了）。
   * 既然用户本来就是点导航柱，那用点击既更真实也更稳。
   */
  const goto = async (route) => {
    const label = RAIL_LABEL[route]
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const b = [...document.querySelectorAll('.nav-item')].find((x) => (x.getAttribute('aria-label') || '') === ${JSON.stringify(label)})
          if (b) { b.click(); return 'rail' }
          location.hash = ${JSON.stringify(route)}
          return 'hash'
        })()`,
        awaitPromise: true,
        returnByValue: true
      })
      await sleep(1700)
      const v = await probeView(route)
      if (v.ok) return v
      console.log(`      视图 ${route} 第 ${attempt} 次没挂上（hash=${v.hash}）：「${v.head}」`)
      await sleep(1200)
    }
    throw new Error(
      `路由 ${route} 连续 3 次都没挂上视图。先跑 node scripts/ui-snapshot-app.mjs 校验快照完整性。`
    )
  }

  summary.viewIdentity = {}
  for (const route of ['#/downloads', '#/settings']) {
    const v = await goto(route)
    summary.viewIdentity[route] = v
    console.log(`      视图身份 ${route}: OK`)
  }
  await goto('#/downloads')

  summary.windowTitle = page.title

  /* ---------- 环境自检：运行中的入口 chunk 必须与产物 index.html 一致 ---------- */
  try {
    const envRun = runNode(['scripts/cdp-run.mjs', String(PORT), 'scripts/ui-env-check.mjs'], 60000)
    const env = JSON.parse(envRun.out.slice(envRun.out.indexOf('{')))
    const html = readFileSync(join(APP_DIR, 'out', 'renderer', 'index.html'), 'utf8')
    const refs = [...html.matchAll(/assets\/([A-Za-z0-9_-]+\.js)/g)].map((m) => m[1])
    const entry = env.steps.entryScripts ?? []
    const consistent = refs.length > 0 && entry.some((e) => refs.includes(e))
    summary.envCheck = { entry, refs, consistent, hasShell: env.steps.hasShell }
    console.log(
      `      环境自检 运行中入口=${entry.join(',')} | 产物引用=${refs.join(',')} → ${consistent ? '一致 ✓' : '✗ 不一致（旧实例/旧构建）'}`
    )
    if (!consistent) throw new Error('运行中的实例与产物不一致：多半连到了旧实例，请重启后重跑。')
  } catch (err) {
    if (String(err.message).includes('不一致')) throw err
    console.log(`      环境自检 跳过（${String(err.message).slice(0, 60)}）`)
  }

  // 等音源装载完成（搜索类用例需要）
  console.log('[0/6] 等音源装载…')
  for (let i = 0; i < 40; i += 1) {
    await sleep(1500)
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(async () => { const l = await window.api.source.list(); return l.filter(s => s.status === 'ready').length })()`,
      awaitPromise: true,
      returnByValue: true
    })
    if ((r.result?.value ?? 0) >= 10) {
      summary.readySources = r.result.value
      break
    }
  }
  console.log(`      可用音源 ${summary.readySources ?? '?'} 个`)

  /* ---------- 1. acceptance ---------- */
  console.log('[1/6] acceptance.mjs（11 项）…')
  const acc = runNode(['scripts/acceptance.mjs', String(PORT)], 420000)
  summary.steps.acceptance = { ok: acc.ok, code: acc.code ?? 0, tail: tail(acc.out, 24) }
  writeFileSync(`${OUT_DIR}\\${LABEL}-acceptance.txt`, acc.out, 'utf8')
  console.log(tail(acc.out, 24))

  /* ---------- 2. 功能回归 ---------- */
  console.log('\n[2/6] lifecycle-probe-func.mjs（15 项功能回归）…')
  const fn = runNode(['scripts/cdp-run.mjs', String(PORT), 'scripts/lifecycle-probe-func.mjs'], 420000)
  summary.steps.funcRegression = { ok: fn.ok, code: fn.code ?? 0, tail: tail(fn.out, 18) }
  writeFileSync(`${OUT_DIR}\\${LABEL}-func.txt`, fn.out, 'utf8')
  console.log(tail(fn.out, 18))

  /* ---------- 3. 格式选择器行为三连 ---------- */
  console.log('\n[3/6] 格式选择器行为三连…')
  const fp = runNode(['scripts/cdp-run.mjs', String(PORT), 'scripts/ui-probe-format-picker.mjs'], 180000)
  let fpJson = null
  try {
    fpJson = JSON.parse(fp.out)
  } catch {
    /* 解析失败就只留原文 */
  }
  let diskCheck = null
  if (fpJson) {
    summary.steps.formatPicker = fpJson.steps
    // 宿主机侧核对落盘：此时防抖(300ms)早已过去，磁盘上应该是「还原后的值」
    const cfgPath = `${PROFILE}\\download-config.json`
    await sleep(700)
    try {
      const disk = JSON.parse(readFileSync(cfgPath, 'utf8'))
      diskCheck = {
        磁盘preferQuality: disk.preferQuality,
        与还原值一致: disk.preferQuality === fpJson.steps.restoredValue,
        探针切换到的值: fpJson.steps.newValue,
        说明:
          '探针先切到 newValue（250ms 内立即生效）再还原；磁盘上应等于 restoredValue，' +
          '证明防抖 300ms 后确实落盘，且还原也落盘了'
      }
    } catch (err) {
      diskCheck = { 读取失败: String(err && err.message) }
    }
    summary.steps.formatPickerDisk = diskCheck
    console.log(`  立即生效: ${fpJson.steps.immediateEffect}  (${fpJson.steps.beforeValue} → ${fpJson.steps.newValue})`)
    console.log(`  选中态跟随: ${fpJson.steps.activeMoved}`)
    console.log(`  新任务用新格式: ${fpJson.steps.newTaskUsesNewFormat} (task.quality=${fpJson.steps.newTaskQuality})`)
    console.log(`  已还原: ${fpJson.steps.restored}  磁盘=${JSON.stringify(diskCheck)}`)
  } else {
    summary.steps.formatPickerRaw = tail(fp.out, 20)
    console.log(tail(fp.out, 20))
  }

  /* ---------- 4. 进度条帧数据 ---------- */
  console.log('\n[4/6] 进度条帧数据（25s 真实下载，rAF 逐帧）…')
  const pf = runNode(['scripts/cdp-run.mjs', String(PORT), 'scripts/ui-probe-progress-frames.mjs'], 240000)
  let pfJson = null
  try {
    pfJson = JSON.parse(pf.out)
  } catch {
    /* ignore */
  }
  if (pfJson) {
    summary.steps.progressFrames = { steps: pfJson.steps, aggregates: pfJson.aggregates }
    const a = pfJson.aggregates
    console.log(`  帧数=${a.帧数} 时长=${a.时长ms}ms`)
    console.log(`  帧间隔 p50/p95/max = ${a.帧间隔_p50}/${a.帧间隔_p95}/${a.帧间隔_max} ms；>33ms 帧 ${a.超过33ms的帧数} 个；>50ms ${a.超过50ms的帧数} 个`)
    console.log(`  填充宽度 前进帧=${a.填充宽度_前进帧} 回退帧=${a.填充宽度_回退帧}（0 = 无倒放）`)
    console.log(`  长任务 ${a.长任务数} 个 / 合计 ${a.长任务总ms}ms`)
    console.log(`  初始绑定: ${JSON.stringify(pfJson.steps.firstFill)}`)
    console.log(`  回退帧: ${a.填充宽度_回退帧} 个；是否都是瞬断: ${a.回退帧是否都是瞬断}`)
    if (a.回退帧明细 && a.回退帧明细.length) {
      console.log(`  回退明细(前3): ${JSON.stringify(a.回退帧明细.slice(0, 3))}`)
    }
    console.log(`  0% 时过渡状态: ${JSON.stringify(pfJson.steps.zeroProgressRule)}`)
    console.log(`  百分比读数种类=${a.百分比读数种类} 首末=${a.百分比首末}`)
  } else {
    summary.steps.progressFramesRaw = tail(pf.out, 20)
    console.log(tail(pf.out, 20))
  }

  /* ---------- 5. 四种任务行状态 ---------- */
  console.log('\n[5/6] 构造四种任务行状态…')
  const bs = runNode(['scripts/cdp-run.mjs', String(PORT), 'scripts/ui-probe-build-states.mjs'], 300000)
  let bsJson = null
  try {
    bsJson = JSON.parse(bs.out)
  } catch {
    /* ignore */
  }
  if (bsJson) {
    summary.steps.buildStates = bsJson.steps
    const del = bsJson.steps.deleteThisFile
    console.log(`  服务端状态: ${JSON.stringify(bsJson.steps.serverStates)}`)
    console.log(`  宿主将删除: ${del}`)
    if (del && existsSync(del)) {
      rmSync(del, { force: true })
      summary.steps.deletedFile = del
    }
    const mm = runNode(
      ['scripts/cdp-run.mjs', String(PORT), 'scripts/ui-probe-materialize-missing.mjs'],
      120000
    )
    try {
      const mmJson = JSON.parse(mm.out)
      summary.steps.materializeMissing = mmJson.steps
      console.log(`  状态普查: ${JSON.stringify(mmJson.steps.stateCensus)}`)
      console.log(`  missing 可见: ${mmJson.steps.missingVisible}`)
      console.log(`  填充绑定: ${JSON.stringify(mmJson.steps.fillBindings)}`)
      console.log(`  还有内联 width: ${mmJson.steps.anyInlineWidth}  全部用 --p: ${mmJson.steps.allUseCustomProp}`)
    } catch {
      summary.steps.materializeMissingRaw = tail(mm.out, 20)
      console.log(tail(mm.out, 20))
    }

    /**
     * 再排一轮：把并发压到 1 并塞 4 条长歌，保证接下来审计的那一刻
     * 「下载中 / 排队中」这两行真的在页面上（本机带宽太快，不加这一步会全跑完）。
     */
    const busy = runNode(
      ['scripts/cdp-run.mjs', String(PORT), 'scripts/ui-probe-keep-busy.mjs'],
      120000
    )
    try {
      const bsJson2 = JSON.parse(busy.out)
      summary.steps.keepBusy = bsJson2.steps
      console.log(`  保持队列忙碌: 行状态 = ${JSON.stringify(bsJson2.steps.domSnapshot)}（在跑 ${bsJson2.steps.inFlight} 条）`)
    } catch {
      summary.steps.keepBusyRaw = tail(busy.out, 14)
      console.log(tail(busy.out, 14))
    }
  } else {
    summary.steps.buildStatesRaw = tail(bs.out, 24)
    console.log(tail(bs.out, 24))
  }

  /* ---------- 6. 分页面设计审计 ---------- */
  console.log('\n[6/6] 分页面设计审计（带 4 种状态行）…')
  const audits = {}
  for (const route of ['#/downloads', '#/settings']) {
    await goto(route)
    const a = runNode(['scripts/design-audit.mjs', String(PORT), '--json', '--no-route'], 180000)
    const start = a.out.indexOf('{')
    if (start >= 0) {
      try {
        const rep = JSON.parse(a.out.slice(start))
        audits[route] = rep
        const shape = rep.形状 ?? rep.圆角 ?? {}
        console.log(
          `  ${route.padEnd(12)} 元素=${String(rep.采样元素数).padStart(4)} 字号=${rep.字号.种类}种 对比不达标=${rep.对比度.不达标数}/${rep.对比度.检查数} 离网=${rep.间距.离网总数}/${rep.间距.检查数} 形状=${JSON.stringify(shape).slice(0, 60)} <24px=${rep.命中区.小于24px数量} 时长=${rep.动效.时长种类}种 reduced=${rep.动效.reducedMotion规则数}`
        )
        if (rep.间距.明细 && rep.间距.明细.length) {
          console.log(`      离网明细: ${rep.间距.明细.slice(0, 6).map((d) => d.value + '×' + d.count).join('  ')}`)
        }
        if (rep.动效.时长明细 && rep.动效.时长明细.length) {
          console.log(`      时长明细: ${rep.动效.时长明细.map((d) => d.value + '×' + d.count).join('  ')}`)
        }
        if (rep.动效.属性明细 && rep.动效.属性明细.length) {
          console.log(`      过渡属性: ${rep.动效.属性明细.map((d) => d.value + '×' + d.count).join('  ')}`)
        }
        if (rep.进度条驱动) {
          console.log(`      进度条驱动: ${JSON.stringify(rep.进度条驱动).slice(0, 200)}`)
        }
      } catch (err) {
        console.log(`  ${route} 审计 JSON 解析失败`)
      }
    }
  }
  summary.steps.audit = audits
  writeFileSync(`${OUT_DIR}\\${LABEL}-audit.json`, JSON.stringify(audits, null, 1), 'utf8')

  /* ---------- 7. 复选框命中区 + 字体族溯源 ---------- */
  console.log('\n[7/7] 复选框命中区（WCAG 2.5.8）…')
  await goto('#/settings')
  const cb = runNode(['scripts/cdp-run.mjs', String(PORT), 'scripts/ui-probe-checkbox.mjs'], 120000)
  let cbJson = null
  try {
    cbJson = JSON.parse(cb.out)
  } catch {
    /* ignore */
  }
  if (cbJson) {
    summary.steps.checkbox = cbJson.steps
    console.log(`  复选框数=${cbJson.steps.count}  全部 ≥24×24: ${cbJson.steps.allHitOk}`)
    console.log(`  视觉方块已绘制: ${cbJson.steps.allVisualBoxDrawn}`)
    console.log(`  真实点击切换仍生效: ${cbJson.steps.toggle ? cbJson.steps.toggle.changed : '-'}  已还原: ${cbJson.steps.toggle ? cbJson.steps.toggle.restoredBack : '-'}`)
  } else {
    summary.steps.checkboxRaw = tail(cb.out, 16)
    console.log(tail(cb.out, 16))
  }

  console.log('\n[7b] 字体族溯源（Noto Sans SC 到底来自谁）…')
  const font = runNode(['scripts/cdp-run.mjs', String(PORT), 'scripts/diag-font-families.mjs'], 120000)
  summary.fontFamilies = tail(font.out, 40)
  console.log(tail(font.out, 24))

  writeFileSync(`${OUT_DIR}\\${LABEL}-summary.json`, JSON.stringify(summary, null, 1), 'utf8')
  console.log(`\n汇总已写: ${OUT_DIR}\\${LABEL}-summary.json`)
} catch (err) {
  summary.error = String(err && err.stack ? err.stack : err)
  console.error('验证流程失败:', err && err.message)
  process.exitCode = 1
} finally {
  if (cdp) cdp.close()
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
