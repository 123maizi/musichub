/**
 * 歌词翻译验证
 *
 * 重点验证四件事：
 *   1. 时间戳是否完整保留（LRC 的命根子，翻坏了整首歌就废了）
 *   2. 分片是否生效（MyMemory 单次上限 500 字符）
 *   3. 行数是否对齐
 *   4. **翻译是否真的发生了** —— 上一版就是栽在这里：
 *      源语言传了 auto 导致全部失败，而失败被静默降级吞掉，
 *      表面上「成功」，返回的其实是原文
 *
 * 运行： npm run verify:translate
 */
import {
  detectSourceLang,
  parseLrcLines,
  translateLrcDetailed,
  translateLyric
} from '../src/main/core/lyric/translate'
import { parseLrc, parseLrcWithTranslation } from '../src/renderer/src/utils/format'

const ENGLISH_LRC = `[ti:Imagine]
[ar:John Lennon]
[al:Imagine]
[00:00.00]Imagine there's no heaven
[00:05.50]It's easy if you try
[00:11.20]No hell below us
[00:16.80]Above us only sky
[00:22.40]Imagine all the people
[00:28.00]Living for today
[00:33.60]
[00:35.00]Imagine there's no countries
[00:40.20]It isn't hard to do
[00:45.80]Nothing to kill or die for
[00:51.40]And no religion too
[00:57.00]Imagine all the people
[01:02.60]Living life in peace
`

console.log(`\n歌词翻译验证\n${'='.repeat(76)}`)

/* ---------------- 1. LRC 解析 ---------------- */
console.log('\n[1] LRC 解析（不联网）')
const parsed = parseLrcLines(ENGLISH_LRC)
const withTime = parsed.filter((line) => line.prefix)
console.log(`    共 ${parsed.length} 行，其中带时间戳 ${withTime.length} 行`)
console.log(`    示例: prefix="${withTime[0].prefix}"  text="${withTime[0].text}"`)

/* ---------------- 2. 语言探测 ---------------- */
console.log('\n[2] 源语言探测（MyMemory 不接受 auto，必须自己判断）')
const samples: [string, string][] = [
  ["Imagine there's no heaven", '英文'],
  ['君の名前は', '日文'],
  ['사랑해요 그대', '韩文'],
  ['Привет мир', '俄文'],
  ['สวัสดีชาวโลก', '泰文'],
  ['我曾经跨过山和大海', '中文'],
  ["We don't need no education 备注：中文", '英夹中']
]
for (const [text, label] of samples) {
  console.log(`    ${label.padEnd(5)} → ${detectSourceLang(text)}`)
}

/* ---------------- 2.5 中文短路（不能拿中文去当英文翻） ---------------- */
console.log('\n[2.5] 中文歌词短路')
const CHINESE_LRC = `[00:00.00]我曾经跨过山和大海
[00:05.00]也穿过人山人海
[00:10.00]我曾经拥有着一切
[00:15.00]转眼都飘散如烟`
const zhResult = await translateLrcDetailed(CHINESE_LRC)
console.log(`    translated=${zhResult.translated}  error="${zhResult.error}"`)
console.log(`    未误翻: ${zhResult.translated === false ? '✓' : '✗ 中文被送去做翻译了！'}`)

/* ---------------- 3. 实际翻译 ---------------- */
console.log('\n[3] 实际翻译（消耗 MyMemory 配额）')
const started = Date.now()
const result = await translateLrcDetailed(ENGLISH_LRC, 'zh-CN')
const cost = Date.now() - started

console.log(`    耗时 ${cost}ms`)
console.log(`    成功翻译: ${result.successCount} / ${result.totalCount} 行`)

if (!result.translated) {
  console.log(`    ✗ 翻译未生效！原因: ${result.error ?? '未知'}`)
} else {
  if (result.error) console.log(`    ⚠ ${result.error}`)

  const outLines = result.lrc.split('\n')
  console.log(`    行数一致: ${outLines.length === parsed.length ? '✓' : '✗'} (${outLines.length}/${parsed.length})`)

  const outWithTime = outLines.filter((line) => /^\[\d{1,3}:\d{1,2}/.test(line))
  console.log(`    时间戳保留: ${outWithTime.length === withTime.length ? '✓' : '✗'} (${outWithTime.length}/${withTime.length})`)

  // 真正判定「翻译是否发生」：逐行对比原文，看有多少行真的变了
  let changed = 0
  let compared = 0
  for (let i = 0; i < parsed.length; i += 1) {
    if (!parsed[i].prefix || !parsed[i].text) continue
    compared += 1
    const srcText = parsed[i].text
    const outText = outLines[i].replace(/^(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/, '')
    if (outText.trim() !== srcText.trim()) changed += 1
  }
  console.log(`    内容真的变了: ${changed}/${compared} 行 ${changed > 0 ? '✓' : '✗ 全是原文！'}`)

  console.log('\n    对照预览:')
  let shown = 0
  for (let i = 0; i < parsed.length && shown < 6; i += 1) {
    if (!parsed[i].prefix || !parsed[i].text) continue
    console.log(`      原: ${parsed[i].text}`)
    console.log(`      译: ${outLines[i].replace(/^(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/, '')}`)
    shown += 1
  }
}

/* ---------------- 4. Lyric 封装 ---------------- */
console.log('\n[4] translateLyric 封装')
const lyric = await translateLyric({ lyric: ENGLISH_LRC, sourceId: 'test' })
if (!lyric) {
  console.log('    ✗ 返回 null（说明翻译失败或无可翻内容）')
} else {
  console.log(`    sourceId: ${lyric.sourceId}`)
  const srcLen = (lyric.lyric || '').length
  const dstLen = (lyric.tlyric || '').length
  console.log(`    原文 ${srcLen} 字符 / 译文 ${dstLen} 字符`)
  console.log(`    长度不同: ${srcLen !== dstLen ? '✓（说明确有翻译）' : '✗（长度一样，疑似原文）'}`)
}

/* ---------------- 5. 与歌词行的合并（界面实际看到的） ---------------- */
console.log('\n[5] 译文合并到歌词行（渲染层真正展示的东西）')
if (!result.translated) {
  console.log('    ⊘ 上一步没翻成，跳过')
} else {
  const lines = parseLrcWithTranslation(ENGLISH_LRC, result.lrc)
  const bare = parseLrc(ENGLISH_LRC)
  const withTrans = lines.filter((line) => line.trans)
  console.log(`    歌词行 ${lines.length} 行，其中带译文 ${withTrans.length} 行`)
  console.log(`    合并生效: ${withTrans.length > 0 ? '✓' : '✗'}`)
  // 合并只该「挂」译文，不该增删行、不该改时间点
  const shapeOk =
    lines.length === bare.length && lines.every((l, i) => l.time === bare[i].time && l.text === bare[i].text)
  console.log(`    原文行与时间点未被破坏: ${shapeOk ? '✓' : '✗'}`)
  console.log('\n    界面效果预览:')
  let shownLines = 0
  for (const line of lines) {
    if (!line.text || shownLines >= 6) continue
    shownLines += 1
    console.log(`      ${line.text}`)
    if (line.trans) console.log(`      └ ${line.trans}`)
  }
}

console.log(`\n${'='.repeat(76)}\n`)
