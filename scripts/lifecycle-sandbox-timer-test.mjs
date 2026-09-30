/**
 * 沙箱定时器回收测试（task-3 专用，不参与应用构建）
 *
 * 判据的选择很关键：
 *   旧代码在 dispose 之后，定时器回调会**提前 return**（`if (self.disposed) return`），
 *   所以「脚本逻辑还跑不跑」根本看不出问题 —— 计数器会假装已经停了。
 *   真正的问题是**句柄本身还在**：那个 setInterval 每 20ms 依然唤醒一次事件循环，
 *   永远 clear 不掉。所以要直接数「活着的定时器句柄」。
 *
 * 本测试用两个互相独立的可观测口径：
 *   1. process.getActiveResourcesInfo() 里 'Timeout' 的数量（进程级事实，不依赖被测代码自证）
 *   2. 脚本自己声明的存活证据：进程能否自然退出。若还挂着 interval，Node 永远不会退出。
 *
 * 用法：node scripts/lifecycle-sandbox-timer-test.mjs <编译产物根目录>
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const OUT_ROOT = resolve(process.argv[2] ?? '.tmp-lifecycle/sbtest/out')
const require = createRequire(import.meta.url)

// 编译产物里 `@main/utils/error` 是 TS 路径别名，Node 不认；这里补一层解析
// （tsc 的 rootDir 就是 main/，所以去掉前缀直接拼在产物根上）
const Module = require('node:module')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (typeof request === 'string' && request.startsWith('@main/')) {
    return originalResolve.call(this, join(OUT_ROOT, request.slice('@main/'.length)), ...rest)
  }
  return originalResolve.call(this, request, ...rest)
}

const sandboxFile = join(OUT_ROOT, 'core', 'source', 'sandbox.js')
if (!existsSync(sandboxFile)) {
  console.error(`找不到编译产物: ${sandboxFile}`)
  process.exit(2)
}
const { SourceSandbox } = require(sandboxFile)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 当前活着的 Timeout 句柄数 —— 进程级事实，被测代码无法伪装 */
const liveTimers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length

/** 兼容新旧两种实现：旧版没有 pendingTimerCount */
const pending = (box) => (typeof box.pendingTimerCount === 'number' ? box.pendingTimerCount : null)

const report = {}
let pass = true

await sleep(120)
const baseTimers = liveTimers()
report.baselineLiveTimers = baseTimers

/* -------- 场景 1：脚本 setInterval 轮询 → dispose 之后不该再有活句柄 -------- */

let intervalTicks = 0
const intervalBox = new SourceSandbox({
  filename: 'timer-probe.js',
  // 模拟第三方音源脚本的后台轮询
  code: `setInterval(function () { __tick() }, 20)`,
  onLog: () => undefined,
  extraGlobals: { __tick: () => { intervalTicks += 1 } }
})
intervalBox.run()

await sleep(250)
const timersWhileRunning = liveTimers()
const ticksBeforeDispose = intervalTicks
intervalBox.dispose()
const registeredAtDispose = pending(intervalBox)

await sleep(400)
const ticksAfterDispose = intervalTicks
const timersAfterDispose = liveTimers()
const leakedTimers = timersAfterDispose - baseTimers

report.scenario1_setInterval = {
  ticksWhileRunning: ticksBeforeDispose,
  liveTimersWhileRunning: timersWhileRunning,
  registeredAtDispose,
  liveTimersAfterDispose: timersAfterDispose,
  baselineLiveTimers: baseTimers,
  leakedTimersAfterDispose: leakedTimers,
  handleLeaked: leakedTimers > 0,
  note:
    leakedTimers > 0
      ? 'dispose 后仍有活着的定时器句柄：setInterval 没被清掉'
      : 'dispose 后定时器句柄已归零'
}
if (leakedTimers > 0) pass = false

/* -------- 场景 2：脚本自己 clearInterval → 登记表要跟着摘除 -------- */

const mark2 = liveTimers()
let clearedTicks = 0
const clearBox = new SourceSandbox({
  filename: 'clear-probe.js',
  code: `
    var id = setInterval(function () { __tick2() }, 20)
    setTimeout(function () { clearInterval(id) }, 120)
  `,
  onLog: () => undefined,
  extraGlobals: { __tick2: () => { clearedTicks += 1 } }
})
clearBox.run()

await sleep(300)
const clearedBefore = clearedTicks
const registeredAfterSelfClear = pending(clearBox)
await sleep(300)
const ticksAfterSelfClear = clearedTicks - clearedBefore
clearBox.dispose()
await sleep(150)
const timersAfterSelfClear = liveTimers() - mark2

report.scenario2_scriptSelfClear = {
  ticksIn300msAfterSelfClear: ticksAfterSelfClear,
  selfClearWorks: ticksAfterSelfClear === 0,
  registeredAfterSelfClear,
  leakedByThisScenario: timersAfterSelfClear
}
if (ticksAfterSelfClear !== 0) pass = false

/* -------- 场景 3：setTimeout 一次性，触发后应自动摘除 -------- */

const mark3 = liveTimers()
const timeoutBox = new SourceSandbox({
  filename: 'timeout-probe.js',
  code: `setTimeout(function () {}, 30); setTimeout(function () {}, 60)`,
  onLog: () => undefined
})
timeoutBox.run()
await sleep(250)
const registeredAfterFire = pending(timeoutBox)
timeoutBox.dispose()
await sleep(150)
const timersAfterOneShot = liveTimers() - mark3

report.scenario3_setTimeout = {
  registeredAfterFire,
  leakedByThisScenario: timersAfterOneShot,
  oneShotReleased: timersAfterOneShot === 0
}
if (timersAfterOneShot !== 0) pass = false

/* -------- 场景 4：3 个 setInterval 并发，dispose 后必须全部回收 -------- */

const mark4 = liveTimers()
const mixedBox = new SourceSandbox({
  filename: 'mixed-probe.js',
  code: `
    setInterval(function () {}, 25)
    setInterval(function () {}, 35)
    setInterval(function () {}, 45)
  `,
  onLog: () => undefined
})
mixedBox.run()
await sleep(200)
const registeredMixed = pending(mixedBox)
mixedBox.dispose()
await sleep(150)
const timersAfterMixed = liveTimers() - mark4
report.scenario4_threeIntervals = {
  registeredWhileRunning: registeredMixed,
  leakedByThisScenario: timersAfterMixed
}
if (timersAfterMixed > 0) pass = false

report.pass = pass
console.log(JSON.stringify(report, null, 2))

/**
 * 最后一道判据：自然退出。
 * 如果还有活着的 interval，Node 的事件循环不会空，进程会一直挂着 ——
 * 这正是「主进程退不干净」在宿主体内的等价现象。
 * 注意这里只置 exitCode、不强制 process.exit：要的就是看它能不能自己走掉。
 */
const watchdog = setTimeout(() => {
  console.error('!! 进程 3 秒内没有自然退出：事件循环被残留句柄吊住')
  process.exit(3)
}, 3000)
watchdog.unref()

if (!pass) process.exitCode = 1
