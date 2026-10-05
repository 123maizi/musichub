import { albumPenalty, artistMatchScore, keywordTokens, normalizeName, toSimplified } from '@shared/originality'
import { titlePurityScore } from '@shared/purity'

type Case = { name: string; singer: string; album: string }
const kw = '周杰伦 晴天'
const tokens = keywordTokens(kw)
const kwNorm = normalizeName(kw)

function score(song: Case): number {
  let s = 0
  let artistBest = 0
  for (const t of tokens) artistBest = Math.max(artistBest, artistMatchScore(song.singer, t))
  s += artistBest

  const name = normalizeName(song.name)
  let titleBest = 0
  for (const t of tokens) {
    if (name === t) titleBest = Math.max(titleBest, 120)
    else if (name.startsWith(t)) titleBest = Math.max(titleBest, 70)
    else if (name.includes(t)) titleBest = Math.max(titleBest, 30)
  }
  if (!tokens.length && kwNorm) {
    if (name === kwNorm) titleBest = 120
    else if (name.startsWith(kwNorm)) titleBest = 70
    else if (name.includes(kwNorm)) titleBest = 30
  }
  s += titleBest
  s += titlePurityScore(song.name)
  if (song.album) s += 8
  s += albumPenalty(song.album)
  return s
}

const cases: Case[] = [
  { name: '晴天', singer: '周杰伦', album: '叶惠美' },
  { name: '晴天 (Live)', singer: '周杰伦', album: '世界巡回演唱会' },
  { name: '晴天 (DJ版)', singer: 'DJ小可', album: 'DJ合集' },
  { name: '晴天', singer: '某某某', album: '抖音热歌精选' },
  { name: '晴天（Cover 周杰伦）', singer: '女声翻唱', album: '网络翻唱' },
  { name: '晴天', singer: '周杰倫', album: '葉惠美' },
  { name: '晴天 (伴奏)', singer: '周杰伦', album: '叶惠美' },
  { name: '晴天 (0.8X)', singer: '周杰伦', album: '叶惠美' },
  { name: '晴天', singer: '周杰伦 (Jay Chou)', album: '叶惠美' }
]

const ranked = cases
  .map((c) => ({ ...c, score: score(c) }))
  .sort((a, b) => b.score - a.score)

const out = {
  关键词: kw,
  片段: tokens,
  '繁简归一': {
    '周杰倫 -> 周杰伦': toSimplified('周杰倫'),
    '葉惠美 -> 叶惠美': toSimplified('葉惠美')
  },
  排序: ranked.map((r, i) => `${i + 1}. ${r.score}分  ${r.name} — ${r.singer} [${r.album || '无专辑'}]`),
  判定: {
    原唱是否第一: ranked[0].name === '晴天' && ranked[0].singer === '周杰伦' ? '✓' : '★ 不是',
    'DJ版是否被压到后面': ranked.findIndex((r) => r.name.includes('DJ')) > 3 ? '✓' : '★ 没压住',
    繁体写法是否被识别为原唱: artistMatchScore('周杰倫', '周杰伦') === 160 ? '✓ 160分' : '★ 未识别',
    括号别名是否识别: artistMatchScore('周杰伦 (Jay Chou)', '周杰伦') === 160 ? '✓ 160分' : '★ 未识别',
    伴奏是否降权: ranked.findIndex((r) => r.name.includes('伴奏')) > 3 ? '✓' : '★ 没压住'
  }
}

console.log(JSON.stringify(out, null, 1))
