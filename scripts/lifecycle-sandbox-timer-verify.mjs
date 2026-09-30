/**
 * 沙箱定时器回收「修复前 / 修复后」对照验证（task-3 专用，不参与应用构建）
 *
 * 做法：把两份 sandbox.ts 用**完全相同**的编译参数各编译一次，再跑同一份测试，
 * 差异只来自源码本身。
 *   - before：.tmp-lifecycle/before/sandbox.ts（改动前的快照）
 *   - after ：src/main/core/source/sandbox.ts（当前源码）
 *
 * 两处必要的工程处理（对两份一视同仁，不影响对照公平性）：
 *   1. 源码里的 `@main/utils/error` 是 TS 路径别名，产物里需要运行时映射；
 *   2. 源码里的 `import.meta.url || __filename` 在 CommonJS 产物里是语法错误，
 *      统一替换成等价的 `__filename`（这正是原文的兜底分支）。
 *
 * 用法：node scripts/lifecycle-sandbox-timer-verify.mjs
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve('F:\\MusicHub')
const WORK = join(ROOT, '.tmp-lifecycle', 'sbtest')
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
const TEST = join(ROOT, 'scripts', 'lifecycle-sandbox-timer-test.mjs')

const VARIANTS = [
  {
    name: 'before',
    label: '修复前（setInterval 首次触发即被摘出登记表）',
    sandbox: join(ROOT, '.tmp-lifecycle', 'before', 'sandbox.ts')
  },
  {
    name: 'after',
    label: '修复后（setInterval 留在登记表，dispose 统一清理）',
    sandbox: join(ROOT, 'src', 'main', 'core', 'source', 'sandbox.ts')
  }
]

function prepare(variant) {
  const srcRoot = join(WORK, variant.name + '-src', 'main')
  const outRoot = join(WORK, variant.name + '-out')
  rmSync(join(WORK, variant.name + '-src'), { recursive: true, force: true })
  rmSync(outRoot, { recursive: true, force: true })

  mkdirSync(join(srcRoot, 'core', 'source'), { recursive: true })
  mkdirSync(join(srcRoot, 'utils'), { recursive: true })

  copyFileSync(variant.sandbox, join(srcRoot, 'core', 'source', 'sandbox.ts'))
  copyFileSync(
    join(ROOT, 'src', 'main', 'core', 'source', 'lx-protocol.ts'),
    join(srcRoot, 'core', 'source', 'lx-protocol.ts')
  )
  copyFileSync(join(ROOT, 'src', 'main', 'utils', 'error.ts'), join(srcRoot, 'utils', 'error.ts'))

  // tsc 会因为「路径别名 + import.meta」报两个 TS 错误并返回非 0，
  // 但产物照样会生成（这两处都在下面被等价处理后使用），所以这里容忍它。
  try {
    execFileSync(
      process.execPath,
      [
        TSC,
        join(srcRoot, 'core', 'source', 'sandbox.ts'),
        // error.ts 必须显式列进来：sandbox 里用的是 `@main/...` 别名，tsc 解析不到，
        // 不显式给出就不会被纳入 program，产物里也就不会有它
        join(srcRoot, 'utils', 'error.ts'),
        '--rootDir',
        srcRoot,
        '--outDir',
        outRoot,
        '--module',
        'commonjs',
        '--target',
        'ES2022',
        '--moduleResolution',
        'node',
        '--esModuleInterop',
        '--skipLibCheck',
        '--types',
        'node'
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
  } catch (err) {
    const emittedProbe = join(outRoot, 'core', 'source', 'sandbox.js')
    if (!existsSync(emittedProbe)) {
      throw new Error('编译失败且无产物:\n' + String(err.stdout ?? err.message))
    }
  }

  // import.meta.url 在 CJS 产物里非法；源码本意就是 `import.meta.url || __filename`
  const emitted = join(outRoot, 'core', 'source', 'sandbox.js')
  if (!existsSync(emitted)) throw new Error('编译产物缺失: ' + emitted)
  const code = readFileSync(emitted, 'utf8')
  writeFileSync(emitted, code.replaceAll('import.meta.url', '__filename'), 'utf8')
  return outRoot
}

const results = []
for (const variant of VARIANTS) {
  const outRoot = prepare(variant)
  let parsed = null
  let raw = ''
  let exitCode = 0
  try {
    raw = execFileSync(process.execPath, [TEST, outRoot], {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (err) {
    exitCode = typeof err.status === 'number' ? err.status : -1
    raw = String(err.stdout ?? '') + String(err.stderr ?? '')
  }
  const jsonStart = raw.indexOf('{')
  if (jsonStart >= 0) {
    try {
      parsed = JSON.parse(raw.slice(jsonStart, raw.lastIndexOf('}') + 1))
    } catch {
      parsed = null
    }
  }
  results.push({ variant: variant.name, label: variant.label, exitCode, result: parsed, raw })
  console.log(`\n===== ${variant.name} · ${variant.label} =====`)
  if (parsed) {
    const s = parsed
    console.log(`  基线活定时器句柄: ${s.baselineLiveTimers}`)
    console.log(
      `  [场景1] 脚本 setInterval(20ms) 跑 ${s.scenario1_setInterval.ticksWhileRunning} 次后 dispose()`
    )
    console.log(
      `          dispose 时登记表条数: ${s.scenario1_setInterval.registeredAtDispose ?? '（旧版无此字段）'}`
    )
    console.log(
      `          dispose 之后仍活着的定时器: ${s.scenario1_setInterval.leakedTimersAfterDispose}  → ${s.scenario1_setInterval.handleLeaked ? '泄漏 ✗' : '已回收 ✓'}`
    )
    console.log(
      `  [场景2] 脚本自己 clearInterval 后仍多跑 ${s.scenario2_scriptSelfClear.ticksIn300msAfterSelfClear} 次；本场景新增残留 ${s.scenario2_scriptSelfClear.leakedByThisScenario} 个 → ${s.scenario2_scriptSelfClear.selfClearWorks ? '正常 ✓' : '异常 ✗'}`
    )
    console.log(
      `  [场景3] 2 个 setTimeout 触发后残留 ${s.scenario3_setTimeout.leakedByThisScenario} 个 → ${s.scenario3_setTimeout.oneShotReleased ? '正常释放 ✓' : '未释放 ✗'}`
    )
    console.log(
      `  [场景4] 3 个 setInterval 并发 → dispose 后残留 ${s.scenario4_threeIntervals.leakedByThisScenario} 个`
    )
    console.log(`  脚本自评 PASS = ${s.pass}`)
  } else {
    console.log('  无法解析结果')
  }
  console.log(
    `  进程退出码 = ${exitCode}${
      exitCode === 0
        ? '（事件循环已排空，自然退出）'
        : exitCode === 3
          ? '（被残留句柄吊住，看门狗强杀）'
          : exitCode === 1
            ? '（断言未全过；进程能自然退出）'
            : '（异常终止：' + exitCode + '）'
    }`
  )
}

const summary = {
  before: { exitCode: results[0].exitCode, ...results[0].result },
  after: { exitCode: results[1].exitCode, ...results[1].result },
  conclusion: {
    bugReproduced: results[0].result
      ? results[0].result.scenario1_setInterval.handleLeaked === true
      : results[0].exitCode === 3,
    fixed: results[1].result ? results[1].result.pass === true && results[1].exitCode === 0 : false
  }
}
console.log('\n===== 汇总 =====')
console.log(JSON.stringify(summary.conclusion, null, 2))
writeFileSync(join(WORK, 'report.json'), JSON.stringify(summary, null, 2), 'utf8')
