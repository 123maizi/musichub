/** 找出 design-audit.mjs 里 AUDIT_SRC 模板字符串内部的反引号（会截断模板、让脚本语法错误） */
import { readFileSync } from 'node:fs'
const TICK = String.fromCharCode(96)
const lines = readFileSync(new URL('./design-audit.mjs', import.meta.url), 'utf8').split(/\r?\n/)
const start = lines.findIndex((l) => l.includes('const AUDIT_SRC'))
const end = lines.findIndex((l, i) => i > start && l.trim() === TICK)
console.log(`AUDIT_SRC 范围: 行 ${start + 1} .. ${end + 1}`)
let hits = 0
lines.forEach((l, i) => {
  if (i > start && i < end && l.includes(TICK)) {
    hits += 1
    console.log(`  反引号 @ 行 ${i + 1}: ${l.trim().slice(0, 90)}`)
  }
})
console.log(hits === 0 ? '干净：模板字符串内部没有反引号' : `需要修 ${hits} 处`)
