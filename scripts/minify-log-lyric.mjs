/** 读应用日志，抽歌词相关行（UTF-8 直读，避免 PowerShell 5.1 按 ANSI 解码乱码） */
import { readFileSync } from 'node:fs'

const path = process.argv[2] || 'F:\\MusicHub\\.tmp\\perf-profile\\musichub.log'
const lines = readFileSync(path, 'utf8').split('\n')
const hit = lines.filter((l) => /歌词|lyric|Lyric/.test(l))
console.log(`日志总行数 ${lines.length}，歌词相关 ${hit.length} 行\n`)
for (const l of hit.slice(-40)) console.log(l.trim().slice(0, 220))
console.log('\n--- 最后 12 行日志 ---')
for (const l of lines.slice(-12)) console.log(l.trim().slice(0, 200))
