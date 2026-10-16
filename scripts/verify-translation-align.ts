/**
 * 译文对齐的单元测试。
 *
 * 用**真实接口报文**当输入（.tmp/lyric-pairs.json，由
 * scripts/probe-translation-coverage.mjs 带 DUMP= 跑出来），
 * 手搓样例测不出这类问题：系统性偏移、行数不等、头部 credits 行
 * 都是真实数据里才有的形态。
 *
 * 用法:
 *   node scripts/probe-translation-coverage.mjs 'Ex-Factor Lauryn Hill' 'Ex-Factor' wy   # DUMP=...
 *   esbuild scripts/verify-translation-align.ts --bundle --format=esm --platform=node \
 *     --outfile=.tmp/verify-translation-align.mjs && node .tmp/verify-translation-align.mjs
 */
import { readFileSync } from 'node:fs'
import { mergeTranslation, parseLrc, translationCoverage } from '../src/renderer/src/utils/format'

interface Case {
  name: string
  main: string
  tlyric: string
  /** 期望配上的最少行数（下界，实测值下方留了余量） */
  minMatched: number
  /** 是否检查前几行的配对内容 */
  expectPairs?: Array<[string, string]>
}

const cases: Case[] = []

/* ------------------------- 真实报文 ------------------------- */

try {
  const raw = JSON.parse(readFileSync('.tmp/lyric-pairs.json', 'utf8'))
  for (const song of raw.结果 ?? []) {
    for (const opt of song.译文选项 ?? []) {
      if (!opt.__raw?.mainLrc || !opt.__raw?.tlyric) continue
      const title = `${song.歌名} / ${opt.平台}`
      cases.push({
        name: `${title}（偏移 ${opt.估计偏移秒}s，旧版只配上 ${opt.现状_能配上几行} 行）`,
        main: opt.__raw.mainLrc,
        tlyric: opt.__raw.tlyric,
        // 真实数据里新版都配到 63/65 以上，这里留足余量取一半
        minMatched: Math.floor((opt.译文行数 || 0) * 0.5)
      })
    }
  }
} catch (err) {
  console.error('缺少真实报文（先跑 DUMP=... 的探针）：', String(err))
  process.exit(2)
}

/* ------------------------- 合成边界 ------------------------- */

/** 主歌词与译文时间戳完全一致（AI 翻译就是这种形态）→ 必须全部配上 */
const sameTime = ['[00:01.00]line one', '[00:05.00]line two', '[00:09.00]line three'].join('\n')
cases.push({
  name: '时间戳完全一致（AI 译文形态）',
  main: sameTime,
  tlyric: ['[00:01.00]第一行', '[00:05.00]第二行', '[00:09.00]第三行'].join('\n'),
  minMatched: 3,
  expectPairs: [
    ['line one', '第一行'],
    ['line two', '第二行'],
    ['line three', '第三行']
  ]
})

/** 译文缺了中间一行 → 其余仍要配上，且不能错位 */
cases.push({
  name: '译文缺行（不许错位）',
  main: ['[00:01.00]a', '[00:05.00]b', '[00:09.00]c'].join('\n'),
  tlyric: ['[00:01.00]甲', '[00:09.00]丙'].join('\n'),
  minMatched: 2,
  expectPairs: [
    ['a', '甲'],
    ['c', '丙']
  ]
})

/** 完全不相关的一份 LRC（另一首歌）→ 基本不该配上，绝不能硬塞 */
cases.push({
  name: '无关歌词（安全性：宁可留空）',
  main: ['[00:10.00]alpha', '[00:20.00]beta', '[00:30.00]gamma'].join('\n'),
  tlyric: ['[03:11.00]完全不同的歌', '[03:44.00]另一段文字'].join('\n'),
  minMatched: 0
})

/* ------------------------- 执行 ------------------------- */

let failed = 0

for (const c of cases) {
  const merged = mergeTranslation(parseLrc(c.main), c.tlyric)
  const withTrans = merged.filter((l) => l.trans)
  const ok = withTrans.length >= c.minMatched

  let pairsOk = true
  const pairNotes: string[] = []
  for (const [from, to] of c.expectPairs ?? []) {
    const hit = merged.find((l) => l.text === from)
    const got = hit?.trans ?? '(无)'
    const good = got === to
    if (!good) pairsOk = false
    pairNotes.push(`${from} → ${got}${good ? ' ✓' : ` ✗ 期望 ${to}`}`)
  }

  const pass = ok && pairsOk
  if (!pass) failed += 1

  console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name}`)
  console.log(
    `      主歌词有字行 ${merged.filter((l) => l.text).length} · 配上译文 ${withTrans.length} 行 · 要求 ≥ ${c.minMatched}`
  )
  for (const note of pairNotes) console.log(`      ${note}`)
}

/* ------------------------- 汇总样例（人眼核对） ------------------------- */

const sample = cases[0]
if (sample) {
  console.log('\n--- 真实报文配对抽样（前 6 行）---')
  const merged = mergeTranslation(parseLrc(sample.main), sample.tlyric).filter((l) => l.text)
  for (const line of merged.slice(0, 6)) {
    console.log(`${line.text.slice(0, 42).padEnd(44)} | ${line.trans ?? '(无译文)'}`)
  }
}

/* ------------------------- 覆盖率门槛（界面用它筛选项） ------------------------- */

console.log('\n--- 覆盖率门槛 translationCoverage ---')
let gateFailed = 0

for (const c of cases) {
  const coverage = translationCoverage(c.main, c.tlyric)
  const merged = mergeTranslation(parseLrc(c.main), c.tlyric).filter((l) => l.trans).length
  // 覆盖率必须与真实合并结果一致，否则界面会按一个数筛、按另一个数显示
  const consistent = coverage === merged
  if (!consistent) gateFailed += 1
  const isUnrelated = c.name.includes('无关歌词')
  const gateOk = isUnrelated ? coverage === 0 : coverage >= c.minMatched
  if (!gateOk) gateFailed += 1
  console.log(
    `${consistent && gateOk ? 'PASS' : 'FAIL'}  ${c.name}\n      覆盖率 ${coverage}（与合并结果${consistent ? '一致' : '不一致'}${isUnrelated ? '；无关歌词必须为 0' : ''}）`
  )
}

console.log(`\n合计 ${cases.length + 5} 项，失败 ${failed + gateFailed}`)
process.exit(failed + gateFailed === 0 ? 0 : 1)
