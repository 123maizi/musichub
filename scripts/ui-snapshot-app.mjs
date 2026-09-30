/**
 * 把构建产物快照成一个独立可运行的应用目录（task-8 专用）
 *
 * 为什么需要它：渲染层是懒加载的，队友一执行构建，`out/renderer/assets/*.js`
 * 的文件名哈希就变了；正在运行的实例里 `index.html` 记的还是旧文件名，
 * 于是 `import()` 404 —— 表现是 **hash 变了但视图不切换**，拿这种实例量
 * 下载页/设置页，得到的全是假数据。
 *
 * ⚠️ 光复制还不够：构建锁只保证「构建之间」串行，不保证「我复制的时候没人构建」。
 * 复制过程中别人一构建，就会拷出半新半旧的一套（index.html 指向还没写出来的 chunk）。
 * 所以这里复制完必须**验证完整性**：把 index.html 与主 chunk 里引用到的所有
 * assets 文件名都抠出来，逐个确认存在；缺任何一个就等一会儿重试。
 *
 * 用法：node scripts/ui-snapshot-app.mjs
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve('F:\\MusicHub')
const DEST = join(ROOT, '.tmp-ui', 'app')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 引用到的 assets 文件名（来自 index.html 与各 chunk 里的 import/引用字符串） */
function referencedAssets(outDir) {
  const refs = new Set()
  const htmlPath = join(outDir, 'renderer', 'index.html')
  if (existsSync(htmlPath)) {
    const html = readFileSync(htmlPath, 'utf8')
    for (const m of html.matchAll(/assets\/([A-Za-z0-9._-]+\.(?:js|css))/g)) refs.add(m[1])
  }
  const assetsDir = join(outDir, 'renderer', 'assets')
  if (existsSync(assetsDir)) {
    for (const f of readdirSync(assetsDir)) {
      if (!f.endsWith('.js')) continue
      const code = readFileSync(join(assetsDir, f), 'utf8')
      // 懒加载 chunk 的引用形如 "./DownloadView-XXXX.js" 或 "assets/DownloadView-XXXX.js"
      for (const m of code.matchAll(/([A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.js)/g)) refs.add(m[1])
    }
  }
  return refs
}

function verify(outDir) {
  const assetsDir = join(outDir, 'renderer', 'assets')
  const refs = referencedAssets(outDir)
  const missing = [...refs].filter((f) => !existsSync(join(assetsDir, f)))
  return { total: refs.size, missing }
}

/** 关键页面 chunk 是否都在（下载页/设置页就是懒加载的） */
function keyChunks(outDir, names) {
  const assetsDir = join(outDir, 'renderer', 'assets')
  if (!existsSync(assetsDir)) return names.map((n) => ({ name: n, ok: false }))
  const files = readdirSync(assetsDir)
  return names.map((n) => ({ name: n, ok: files.some((f) => f.startsWith(n + '-') && f.endsWith('.js')) }))
}

let attempt = 0
let result = null
for (; attempt < 6; attempt += 1) {
  rmSync(join(DEST, 'out'), { recursive: true, force: true })
  mkdirSync(DEST, { recursive: true })
  cpSync(join(ROOT, 'out'), join(DEST, 'out'), { recursive: true })

  const v = verify(join(DEST, 'out'))
  const keys = keyChunks(join(DEST, 'out'), ['DownloadView', 'SettingsView', 'SearchView', 'index'])
  const keyOk = keys.every((k) => k.ok)
  if (v.missing.length === 0 && keyOk) {
    result = { attempt: attempt + 1, refs: v.total, keys }
    break
  }
  console.log(
    `  快照第 ${attempt + 1} 次不完整：缺失 ${v.missing.length} 个 chunk` +
      `（${v.missing.slice(0, 4).join(', ')}）；关键 chunk ${JSON.stringify(keys)} —— 等 800ms 重试`
  )
  await sleep(800)
}

if (!result) {
  console.error('!! 快照连续 6 次都不完整，队友可能一直在构建。请稍后重试。')
  process.exit(1)
}

const pkg = join(DEST, 'package.json')
if (!existsSync(pkg)) {
  writeFileSync(pkg, JSON.stringify({ name: 'musichub', version: '1.0.0', main: 'out/main/index.js' }, null, 2), 'utf8')
}

const resDir = join(DEST, 'resources')
if (!existsSync(resDir)) {
  const { execFileSync } = await import('node:child_process')
  try {
    execFileSync('cmd', ['/c', 'mklink', '/J', resDir, join(ROOT, 'resources')], { stdio: 'ignore' })
  } catch {
    cpSync(join(ROOT, 'resources'), resDir, { recursive: true })
  }
}

const mainSize = statSync(join(DEST, 'out', 'main', 'index.js')).size
console.log(
  `快照完成（第 ${result.attempt} 次尝试，校验 ${result.refs} 个 assets 全部存在）: ${DEST}`
)
console.log(`  关键 chunk: ${result.keys.map((k) => k.name + (k.ok ? '✓' : '✗')).join(' ')}`)
console.log(`  out/main/index.js = ${mainSize} 字节`)
