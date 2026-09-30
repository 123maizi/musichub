/** 静态体检：压缩后的主进程产物里，沙箱契约与中文是否完好 */
import { readFileSync } from 'node:fs'

const t = readFileSync('F:\\MusicHub\\out\\main\\index.js', 'utf8')

console.log('--- toString() 出现处上下文（确认不是对函数做源码字符串化）---')
let i = -1
let n = 0
while ((i = t.indexOf('toString()', i + 1)) >= 0 && n < 4) {
  n += 1
  console.log(`[${n}] ...${t.slice(Math.max(0, i - 90), i + 45)}...`)
}

console.log('\n--- UTF-8 中文完整性 ---')
const kw = t.match(/name:"(酷我音乐)"/)
console.log('  PLATFORM_META 中文:', kw ? `OK (${kw[1]})` : '未找到（可能被转义）')
const zh = t.match(/[未知歌曲]{4}/)
console.log('  中文串抽样:', zh ? `OK (${zh[0]})` : '未找到')

console.log('\n--- 沙箱注入对象（lx）在压缩产物里的样子 ---')
const j = t.indexOf('EVENT_NAMES:')
console.log(t.slice(Math.max(0, j - 70), j + 260))

console.log('\n--- 沙箱全局键名 ---')
for (const key of ['console:', 'module:', 'exports:', 'require:', 'Buffer:', 'URL:', 'URLSearchParams:', 'setTimeout:', 'setInterval:', 'globalThis:', 'window:', 'self:', 'fetch']) {
  console.log(`  ${key.padEnd(18)} ${t.includes(key) ? 'OK' : '缺失'}`)
}

console.log('\n--- vm 执行路径 ---')
const vmUse = t.match(/new \w+\.Script\(|runInContext/)
console.log('  Script/runInContext:', vmUse ? vmUse[0] : '未找到')
console.log('  脚本源码来自运行时字符串:', /options\.code|\.code,/.test(t) || t.includes('runTimeoutMs') ? 'OK（runTimeoutMs 等选项仍在）' : '需人工确认')
