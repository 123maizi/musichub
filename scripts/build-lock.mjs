/**
 * 构建串行锁。
 *
 * 四个 agent 共享同一个 F:\MusicHub\out 输出目录。如果两个人同时跑
 * electron-vite build，产物会互相覆盖 —— 表现为「明明改了却没生效」
 * 或者「测出来一个不可能的结果」，排查起来极浪费时间。
 *
 * 用法：node scripts/build-lock.mjs [持有者标签]
 * 行为：拿不到锁就等待（最多 120 秒），拿到后执行构建，结束释放。
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = 'F:\\MusicHub'
const LOCK = join(ROOT, '.tmp', 'build.lock')
const LABEL = process.argv[2] || process.env.DSH_AGENT_NAME || 'unknown'
const STALE_MS = 120_000
const WAIT_MS = 180_000

mkdirSync(join(ROOT, '.tmp'), { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function acquire() {
  const started = Date.now()
  for (;;) {
    try {
      // wx 模式：文件已存在就抛错，天然互斥，不需要额外机制
      writeFileSync(LOCK, JSON.stringify({ label: LABEL, at: Date.now() }), { flag: 'wx' })
      return true
    } catch {
      // 锁文件存在 —— 判断是不是上一次崩溃留下的死锁
      try {
        const st = statSync(LOCK)
        if (Date.now() - st.mtimeMs > STALE_MS) {
          console.log(`[build-lock] 发现超时锁（${Math.round((Date.now() - st.mtimeMs) / 1000)}s），强制接管`)
          unlinkSync(LOCK)
          continue
        }
        let holder = '?'
        try {
          holder = JSON.parse(readFileSync(LOCK, 'utf8')).label
        } catch {
          /* 锁文件内容坏了也照样等 */
        }
        if (Date.now() - started > WAIT_MS) {
          console.log(`[build-lock] 等待 ${holder} 超时，强行接管`)
          unlinkSync(LOCK)
          continue
        }
        await sleep(400)
      } catch {
        // 锁刚好被释放，立刻重试
      }
    }
  }
}

function release() {
  try {
    if (existsSync(LOCK)) unlinkSync(LOCK)
  } catch {
    /* 释放失败也无所谓，有超时兜底 */
  }
}

await acquire()
const t0 = Date.now()
let code = 0
try {
  console.log(`[build-lock] ${LABEL} 获得锁，开始构建`)
  execFileSync(
    process.execPath,
    [join(ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), 'build'],
    { cwd: ROOT, stdio: 'inherit' }
  )
  console.log(`[build-lock] 构建完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
} catch (err) {
  code = 1
  console.error(`[build-lock] 构建失败: ${err?.message ?? err}`)
} finally {
  release()
}
process.exit(code)
