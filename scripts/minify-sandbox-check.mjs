/** 打印压缩产物里的沙箱全局对象字面量，确认注入的键名一个不少 */
import { readFileSync } from 'node:fs'
const t = readFileSync('F:\\MusicHub\\out\\main\\index.js', 'utf8')
const i = t.indexOf('queueMicrotask')
console.log('--- 沙箱全局对象（压缩后原文）---')
console.log(t.slice(Math.max(0, i - 700), i + 260))
console.log('\n--- 关键键名速查 ---')
const region = t.slice(Math.max(0, i - 900), i + 500)
for (const k of ['console', 'module', 'exports', 'require', 'Buffer', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'process', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'atob', 'btoa', 'fetch', 'lx', 'globalThis', 'window', 'self']) {
  const re = new RegExp(`(^|[{,\\s])${k}\\s*[:,}]`)
  console.log(`  ${k.padEnd(18)} ${re.test(region) ? 'OK' : '需人工确认'}`)
}
