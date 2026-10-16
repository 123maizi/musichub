/**
 * 歌词行分类的单元检查（纯函数，不依赖 app）。
 * 这些分类决定了「哪些行不算缺译文」「哪些行不进歌词流」，判错会直接影响观感。
 */
import {
  isLyricMetaLine,
  isLyricNoiseLine,
  isLyricInterjection,
  splitLyricLines,
  parseLrc
} from '../src/renderer/src/utils/format'

const meta: Array<[string, boolean]> = [
  ['制作人 : Steve Mac', true],
  ['作词 : Ed Sheeran/Johnny McDaid', true],
  ['作曲 : Max Martin', true],
  ['主人声 : Ed Sheeran', true],
  ['和声 : Ed Sheeran/Geo Gabriel', true],
  ['Drums : Chris Laws', true],
  ['Mixed at The Mixsuite (South London)', true],
  ['Producer: Lauryn Hill', true],
  ['Writer: Lauryn Hill', true],
  ['Sample: Can It Be All So Simple(1993)', true],
  ["It could all be so simple", false],
  ["But you'd rather make it hard (Huh, uh)", false],
  ['I look, around and', false],
  ['制作人', true]
]

const noise: Array<[string, boolean]> = [
  ['·', true],
  ['—', true],
  ['...', true],
  ['[00:12.00]', true],
  ['Yeah', false],
  ['Oh—i—oh—i—oh—i—oh—i', false]
]

const inter: Array<[string, boolean]> = [
  ['Yeah', true],
  ['Hey, hey, hey', true],
  ['Oh—i—oh—i—oh—i—oh—i', false],
  ['I look, around and', false],
  ['(Yeah)', true]
]

let bad = 0
const check = (name: string, text: string, got: boolean, want: boolean): void => {
  if (got !== want) {
    bad += 1
    console.log(`FAIL ${name} ${JSON.stringify(text)} got=${got} want=${want}`)
  }
}
for (const [t, w] of meta) check('meta', t, isLyricMetaLine(t), w)
for (const [t, w] of noise) check('noise', t, isLyricNoiseLine(t), w)
for (const [t, w] of inter) check('inter', t, isLyricInterjection(t), w)

const src = [
  '[00:00.00]制作人 : Steve Mac',
  '[00:01.00]·',
  '[00:02.00]Yeah',
  '[00:03.00]It could all be so simple'
].join('\n')
const split = splitLyricLines(parseLrc(src))
console.log('歌词流:', JSON.stringify(split.lines.map((l) => l.text)))
console.log('信息行:', JSON.stringify(split.info.map((l) => l.text)))
console.log(bad === 0 ? '✓ 分类全部正确' : `★ ${bad} 项不对`)
process.exit(bad === 0 ? 0 : 1)
