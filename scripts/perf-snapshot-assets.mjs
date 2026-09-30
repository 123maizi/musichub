/**
 * 记录 out/renderer/assets 的体积快照，供优化前后对比。
 * 用法： node scripts/perf-snapshot-assets.mjs <标签>
 * 输出同时打印，并把快照写进 .tmp/perf-assets-<标签>.json
 */
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'F:\\MusicHub'
const DIR = join(ROOT, 'out', 'renderer', 'assets')
const label = process.argv[2] || 'snapshot'

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.js') || f.endsWith('.css'))
  .map((f) => ({ name: f, bytes: statSync(join(DIR, f)).size }))
  .sort((a, b) => b.bytes - a.bytes)

const total = files.reduce((s, f) => s + f.bytes, 0)
const js = files.filter((f) => f.name.endsWith('.js'))
const css = files.filter((f) => f.name.endsWith('.css'))
const mainChunk = js.find((f) => /^index-.*\.js$/.test(f.name))

const out = {
  label,
  at: new Date().toISOString(),
  fileCount: files.length,
  totalBytes: total,
  jsBytes: js.reduce((s, f) => s + f.bytes, 0),
  cssBytes: css.reduce((s, f) => s + f.bytes, 0),
  mainChunk: mainChunk ? { name: mainChunk.name, bytes: mainChunk.bytes } : null,
  files
}

mkdirSync(join(ROOT, '.tmp'), { recursive: true })
writeFileSync(join(ROOT, '.tmp', `perf-assets-${label}.json`), JSON.stringify(out, null, 2))

console.log(`[${label}] 文件 ${out.fileCount} 个 · 合计 ${(total / 1024).toFixed(2)} KiB`)
console.log(`  JS  ${(out.jsBytes / 1024).toFixed(2)} KiB`)
console.log(`  CSS ${(out.cssBytes / 1024).toFixed(2)} KiB`)
console.log(`  主 chunk ${mainChunk?.name}: ${mainChunk?.bytes} B (${((mainChunk?.bytes ?? 0) / 1024).toFixed(2)} KiB)`)
console.log('  最大的 8 个：')
for (const f of files.slice(0, 8)) console.log(`    ${String(f.bytes).padStart(8)}  ${f.name}`)
