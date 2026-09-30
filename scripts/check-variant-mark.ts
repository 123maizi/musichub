/** 检查 hasVariantMark 对这几条真实标题的判定 */
import { hasVariantMark, titlePurityScore, splitBrackets, VARIANT_WORDS } from '../src/shared/purity'

const titles = [
  '晴天(深情版)',
  '晴天',
  '晴天 (女声版))',
  '晴天 (钢琴版) [原唱: 周杰伦]',
  '稻香(治愈版)',
  '稻香(正式版)',
  '稻香',
  '告白气球（Cover）',
  '告白气球（原版）',
  '告白气球 (Live)',
  '圣诞星（feat. 杨瑞代）',
  '夜曲'
]

console.log('变体词表里有这些相关词吗：')
for (const w of ['深情版', '治愈版', '正式版', 'Cover', '翻唱', '女声版', '钢琴版', 'Live', '原版']) {
  console.log(`  ${w}: ${VARIANT_WORDS.includes(w) ? '✓ 在表里' : '✗ 不在表里'}`)
}
console.log('')

for (const t of titles) {
  const s = splitBrackets(t)
  console.log(
    `${hasVariantMark(t) ? '判定为变体' : '判定为原版'}  纯净分=${String(titlePurityScore(t)).padStart(5)}  ${t}`
  )
  console.log(`     括号内=[${s.brackets.join(' | ')}]  括号外="${s.outside}"`)
}
