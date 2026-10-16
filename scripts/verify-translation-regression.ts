/**
 * 译文对齐的新旧算法 A/B（用真实语料）。
 *
 * 用户报的是回归：「更新后很多本来有一半中文歌词的歌，现在完全没有中文翻译了」。
 * 这个脚本把 .tmp/lyric-corpus.json（真实接口报文）逐条跑两遍：
 *   · 旧算法：1.4.8 里的实现（这里原样复制，含它对空文本行也参与匹配的行为）
 *   · 新算法：当前 src 里的实现
 * 只要出现「旧 > 0、新 = 0」，就是一次真实回归，必须能看到是哪一条、差在哪。
 *
 * 用法：
 *   node scripts/dump-lyric-corpus.mjs 9233
 *   esbuild scripts/verify-translation-regression.ts --bundle --format=esm --platform=node \
 *     --outfile=.tmp/verify-translation-regression.mjs && node .tmp/verify-translation-regression.mjs
 */
import { readFileSync } from 'node:fs'
import { mergeTranslation, parseLrc, translationCoverage, type LyricLine } from '../src/renderer/src/utils/format'

/** 1.4.8 的实现，原样复制（对照用，不要改） */
function mergeOld(lines: LyricLine[], tlyric?: string): LyricLine[] {
  if (!tlyric || !tlyric.trim() || lines.length === 0) return lines
  const trans = parseLrc(tlyric).filter((line) => line.text)
  if (trans.length === 0) return lines
  const TRANS_TOLERANCE = 0.5
  return lines.map((line) => {
    let best: LyricLine | null = null
    let bestGap = Number.POSITIVE_INFINITY
    for (const item of trans) {
      const gap = Math.abs(item.time - line.time)
      if (gap < bestGap) {
        bestGap = gap
        best = item
      }
      if (item.time > line.time + TRANS_TOLERANCE) break
    }
    if (!best || bestGap > TRANS_TOLERANCE) return line
    if (best.text === line.text) return line
    return { ...line, trans: best.text }
  })
}

interface Entry {
  song: string
  platform: string
  sourceId?: string | null
  base: string
  baseTlyric: string
  options: Array<{ platform: string; tlyric: string }>
}

const corpus: Entry[] = JSON.parse(readFileSync('.tmp/lyric-corpus.json', 'utf8'))

const count = (lines: LyricLine[]): number => lines.filter((l) => !!l.trans).length

let regressions = 0
let improvements = 0
const rows: string[] = []

for (const entry of corpus) {
  const main = parseLrc(entry.base)
  const sources: Array<[string, string]> = []
  if (entry.baseTlyric) sources.push(['歌词自带译文', entry.baseTlyric])
  for (const opt of entry.options) sources.push([opt.platform, opt.tlyric])

  for (const [label, tlyric] of sources) {
    const oldCount = count(mergeOld(main, tlyric))
    const newCount = count(mergeTranslation(main, tlyric))
    const coverage = translationCoverage(entry.base, tlyric)
    const flag = newCount < oldCount ? '★ 回归' : newCount > oldCount ? '↑ 提升' : '= 持平'
    if (newCount < oldCount) regressions += 1
    if (newCount > oldCount) improvements += 1
    rows.push(
      [
        flag.padEnd(6),
        String(oldCount).padStart(4),
        String(newCount).padStart(4),
        String(coverage).padStart(4),
        String(main.filter((l) => l.text).length).padStart(4),
        entry.song.slice(0, 30).padEnd(32),
        entry.platform.padEnd(4),
        label
      ].join(' ')
    )
  }
}

console.log('   标记   旧  新  覆盖 原文  曲目                             平台 译文来源')
console.log(rows.join('\n'))

console.log(`\n语料 ${corpus.length} 条 · 译文来源 ${rows.length} 个`)
console.log(`回归（新 < 旧）: ${regressions}   提升（新 > 旧）: ${improvements}`)

const fatal = rows.filter((r) => r.startsWith('★ 回归') && /   0 /.test(r))
console.log(`其中「旧有、新归零」: ${fatal.length}`)
if (fatal.length) {
  console.log('\n--- 归零明细 ---')
  console.log(fatal.join('\n'))
}

process.exit(0)
