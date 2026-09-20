/**
 * 去掉 UTF-8 BOM。
 *
 * 起因：Windows PowerShell 的 `Set-Content -Encoding utf8` 会写 BOM，
 * 而 JSON / 某些工具链遇到 BOM 会直接解析失败
 * （package.json 被加上 BOM 后，vite 报 "Unexpected token '﻿'"）。
 * 只处理仓库自己的文件，node_modules 一律不动。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, extname, relative } from 'node:path'

const root = process.argv[2] ?? process.cwd()
const SKIP_DIRS = new Set(['node_modules', '.git', 'release', 'out', '.tmp', 'dist'])
const KEEP_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue', '.json', '.css', '.yml', '.yaml', '.md', '.txt'])

const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const fixed = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full)
      continue
    }
    if (!KEEP_EXT.has(extname(name))) continue

    const buf = readFileSync(full)
    if (buf.length >= 3 && buf.subarray(0, 3).equals(BOM)) {
      writeFileSync(full, buf.subarray(3))
      fixed.push(relative(root, full))
    }
  }
}

walk(root)

if (fixed.length === 0) {
  console.log('没有文件带 BOM')
} else {
  console.log(`已去掉 ${fixed.length} 个文件的 BOM：`)
  for (const f of fixed) console.log(`  ${f}`)
}
