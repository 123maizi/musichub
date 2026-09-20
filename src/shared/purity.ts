/**
 * 歌曲标题纯净度
 *
 * 起因：搜「晴天」，前排常被 DJ 版 / 伴奏 / 变速版 / 烟嗓版淹没，
 * 原唱反而沉在十几条之后。用户要的东西很简单 —— 名称干净的正常版本排前面，
 * 带花里胡哨后缀的往后放。
 *
 * 设计上刻意分成两档，而不是一个大词表：
 *
 *  - **强改版词**：出现基本可以断定不是原版（DJ / 伴奏 / 变速 / 魔改 …）。
 *    搜索里重罚；艺人页那个「隐藏魔改」开关也只认这一档，
 *    免得把 Live、翻唱这类很多人真在找的版本也一起藏掉。
 *  - **弱改版词**：是另一种演绎，但属于正常发行（Live / 翻唱 / 钢琴版 …）。
 *    只在搜索里轻度降权，不隐藏。
 *
 * 匹配上有个坑必须避开：英文词不能直接做子串匹配 ——
 * `live` 会命中 Oliver、`cover` 会命中 Cover Me 这种正经歌名。
 * 所以纯拉丁词一律加边界判断，中文词才用子串。
 */

/** 强改版词：命中即可判定「不是原版」 */
export const STRONG_VARIANT_WORDS: string[] = [
  // —— 用户点名要压的 ——
  'dj',
  '魔改',
  '变速',
  '快速',
  '抒情版',
  '烟嗓版',
  // —— 同类：加工/变速/变调 ——
  '加速',
  '减速',
  '慢速',
  '慢摇',
  '变调',
  '转调',
  '降调',
  '升调',
  '变声',
  '鬼畜',
  '电音',
  '混音',
  'remix',
  'mashup',
  'medley',
  'nightcore',
  'slowed',
  'spedup',
  'speedup',
  'bassboosted',
  'bootleg',
  'parody',
  '8d',
  '环绕',
  '重低音',
  '低音炮',
  // —— 伴奏/消音类：明确不是原唱 ——
  '伴奏',
  '原版伴奏',
  '纯伴奏',
  'karaoke',
  'ktv',
  '消音',
  '无人声',
  'instrumental',
  '器乐',
  // —— 短视频/铃声类 ——
  '抖音',
  '快手',
  '网红',
  '铃声',
  '试听',
  '抢听',
  '片段',
  '卡点',
  '剪辑',
  '高潮版',
  '串烧',
  '喊麦',
  '土嗨',
  '广场舞',
  '车载',
  '非主流',
  // —— 直接标了「改」的 ——
  '改版',
  '改编版',
  '恶搞',
  '搞笑',
  '山寨',
  // —— 音色/速度的加工标记 ——
  '倍速',
  '降速',
  '升速',
  '奶音',
  '少年音',
  '大叔音',
  '慢板',
  '快板'
]

/** 弱改版词：另一种正常演绎，只降权、不隐藏 */
export const MILD_VARIANT_WORDS: string[] = [
  'cover',
  '翻唱',
  '翻自',
  'live',
  '现场',
  '演唱会',
  '不插电',
  'unplugged',
  'acoustic',
  '纯音乐',
  '钢琴',
  '吉他',
  '古筝',
  '八音盒',
  '小提琴',
  '二胡',
  '阿卡贝拉',
  'acapella',
  '清唱',
  '和声',
  '合唱',
  '对唱',
  '群星',
  '女声',
  '男声',
  '童声',
  '女版',
  '男版',
  '方言',
  '说唱版',
  '抒情',
  '烟嗓',
  '温柔版',
  '安静版',
  '完整版',
  '修复版',
  '重制',
  'remaster',
  'version',
  'ver'
]

/** 全部改版词 */
export const VARIANT_WORDS: string[] = [...STRONG_VARIANT_WORDS, ...MILD_VARIANT_WORDS]

/**
 * 括号字符表。
 * 中英文全半角都收进来 —— 音源里的写法五花八门，
 * 只认 `()` 会漏掉 【DJ版】 这种最常见的写法。
 */
const BRACKET_PAIRS: [string, string][] = [
  ['(', ')'],
  ['（', '）'],
  ['[', ']'],
  ['［', '］'],
  ['【', '】'],
  ['{', '}'],
  ['｛', '｝'],
  ['〔', '〕'],
  ['〈', '〉'],
  ['<', '>'],
  ['「', '」'],
  ['『', '』'],
  ['《', '》']
]

const OPENERS = BRACKET_PAIRS.map(([open]) => open)
const CLOSERS = BRACKET_PAIRS.map(([, close]) => close)

/** 纯拉丁/数字词（需要边界判断） */
function isLatinWord(word: string): boolean {
  return /^[a-z0-9]+$/i.test(word)
}

/**
 * 标题里是否出现某个词。
 *
 * 拉丁词加边界：`live` 不该命中 Oliver、`cover` 不该命中 Discovery。
 * 中文没有词边界的概念，直接找子串。
 */
function containsWord(text: string, word: string): boolean {
  if (!text) return false
  if (!isLatinWord(word)) return text.includes(word)
  const pattern = new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, 'i')
  return pattern.test(text)
}

function containsAny(text: string, words: string[]): boolean {
  if (!text) return false
  return words.some((word) => containsWord(text, word))
}

/**
 * 把标题拆成「括号内的内容」与「括号外的正文」。
 *
 * 为什么一定要分开：`晴天 (DJ版)` 和 `晴天DJ版` 都能看出是改版，
 * 但 `晴天 (Live)` 和一首真的叫《现场》的歌是两回事。
 * 括号里的内容更像「附加说明」，权重应当低于正文。
 */
export function splitBrackets(title: string): { brackets: string[]; outside: string } {
  const brackets: string[] = []
  let outside = ''
  let depth = 0
  let current = ''

  for (const ch of title) {
    if (OPENERS.includes(ch)) {
      depth += 1
      if (depth === 1) current = ''
      continue
    }
    if (CLOSERS.includes(ch)) {
      if (depth > 0) {
        depth -= 1
        if (depth === 0) {
          brackets.push(current)
          current = ''
        }
      }
      continue
    }
    if (depth > 0) current += ch
    else outside += ch
  }
  // 括号没闭合时把残留也当括号内容，避免漏判
  if (current) brackets.push(current)

  return { brackets, outside }
}

/**
 * 速度倍率标记：`0.8X`、`1.2倍`、`1.25x` 这类。
 *
 * 实测漏网率不低 —— 「晴天（0.8X腾讯VIP推荐歌曲）」这种既没写「变速」
 * 也没写「加速」，靠词表永远收不全，所以直接用结构性规则兜住。
 */
const SPEED_MULTIPLIER = /\d+(?:\.\d+)?\s*(?:x|倍)(?![a-z0-9])/i

/**
 * 括号里以「版」结尾的短标签，视为改版说明。
 *
 * 「晴天（吉他版）」「晴天（治愈版）」「晴天（深情版）」……
 * 这种写法几乎无穷无尽，逐个人工收录是收不完的，
 * 但结构上有共性：**短** + 以「版」收尾。
 * 限制长度是为了避开「（电影《xxx》中文主题曲完整版）」这种正常长说明。
 */
function looksLikeVersionTag(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 10) return false
  return t.endsWith('版')
}

/**
 * 括号里以 AI 开头的，基本是 AI 翻唱（「（AI纳西妲）」「（AI孙燕姿）」）。
 *
 * 这类最近在各平台泛滥得厉害。边界用 `(?![a-z])` 是为了放行
 * Aimee、Air 这类正常名字 —— 中文名接在 AI 后面才判定命中。
 */
function looksLikeAiCover(text: string): boolean {
  return /^ai(?![a-z])/i.test(text.trim())
}

/** 标题是否带改版痕迹（艺人页的「隐藏魔改」用这一档） */
export function hasVariantMark(title: string): boolean {
  const { brackets, outside } = splitBrackets(title)
  const text = `${outside} ${brackets.join(' ')}`
  if (SPEED_MULTIPLIER.test(text)) return true
  if (brackets.some(looksLikeVersionTag)) return true
  if (brackets.some(looksLikeAiCover)) return true
  return containsAny(text, VARIANT_WORDS)
}

/**
 * 标题纯净度得分。
 *
 * 正分 = 干净，负分 = 改版。分值只影响排序，不改动展示字段，
 * 也不会把任何结果藏起来 —— 用户想找改版时照样翻得到，只是排在后面。
 */
export function titlePurityScore(title: string): number {
  if (!title) return 0

  const { brackets, outside } = splitBrackets(title)
  const bracketText = brackets.join(' ')

  // 倍速标记：等价于「变速」，按强改版处理
  if (SPEED_MULTIPLIER.test(outside) || SPEED_MULTIPLIER.test(bracketText)) return -120

  // 正文里直接带改版词（「晴天DJ版」）比括号里带（「晴天 (DJ版)」）更该沉
  if (containsAny(outside, STRONG_VARIANT_WORDS)) return -120
  if (containsAny(outside, MILD_VARIANT_WORDS)) return -70
  if (containsAny(bracketText, STRONG_VARIANT_WORDS)) return -90
  if (containsAny(bracketText, MILD_VARIANT_WORDS)) return -40

  // 词表没收录、但结构上就是「某某版」的短标签
  if (brackets.some(looksLikeVersionTag)) return -40
  // AI 翻唱：同属改版，但那是另一个演绎而非原曲，按弱档处理
  if (brackets.some(looksLikeAiCover)) return -40

  // 干干净净的名字：加分，让它们整体浮上来
  return 40
}

/**
 * 用户是不是在专门找改版。
 *
 * 搜「晴天 DJ版」时，降权会让用户想找的东西沉下去 —— 那就太蠢了。
 * 搜索词本身带改版词时，整套惩罚直接不生效。
 */
export function keywordWantsVariant(keyword: string): boolean {
  return containsAny(keyword.trim().toLowerCase(), VARIANT_WORDS)
}

/** 供界面复用：从一批歌里挑出带改版痕迹的 */
export function countVariantSongs(titles: string[]): number {
  return titles.filter((title) => hasVariantMark(title)).length
}
