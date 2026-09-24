/**
 * 歌词机器翻译
 *
 * 用途：外语歌（尤其是纯英文歌）没有官方翻译时，让用户一键把歌词翻成中文。
 *
 * 数据源选择来自实测：Google 的公开接口在国内超时，百度 / 360 的免费接口
 * 都需要 token 或返回空，最终只有 MyMemory 可用。
 *
 * MyMemory 有四个必须绕开的坑（全都是实测踩出来的）：
 *   1. **不接受 auto 源语言** —— 传 `langpair=auto|zh-CN` 直接 403，
 *      必须点名具体语言（en / ja / ko …），所以这里做了一层语言探测
 *   2. **单次查询上限 500 字符** —— 一首歌词上千字符，必须分片
 *   3. **超限或参数错误时仍返回 HTTP 200**，把错误信息塞在 translatedText 里——
 *      只看状态码会把 "QUERY LENGTH LIMIT EXCEEDED" 当成译文显示给用户
 *   4. **失败绝不能静默吞掉** —— 曾经因为降级逻辑保留原文、又不报告，
 *      导致「翻译成功」但内容原封不动。所以这里明确返回成功与否，
 *      并且用「内容是否真的变了」计数，而不是拿请求成功冒充翻译成功
 *   5. **短句偶发原样退回** —— 所以对没翻动的行再做一轮单行补救
 *
 * 另外：中文歌词直接短路，不送翻译（送过去会被当英文处理，返回一堆废话）。
 *
 * 歌词是 LRC 格式，每行带时间戳；只翻文本，时间戳原样保留。
 */
import type { AiConfig } from '@shared/types/ai'
import type { Lyric } from '@shared/types/music'
import { httpRequest } from '../net/http'
import { translateLinesWithAi, type SongContext } from './ai-translate'
import { getCachedTranslation, putCachedTranslation } from './translate-cache'

/** MyMemory 单次查询上限（留余量，按 480 分片） */
const CHUNK_LIMIT = 480

/**
 * 逐行补救的次数上限。
 * MyMemory 对短句、重复句偶发「把原文照抄回来」，单行重试一次多半就好；
 * 但要设上限，否则一首 40 行的歌会打出 40 次请求去烧配额。
 */
const RETRY_LIMIT = 12

/** 时间戳前缀：一行可能带多个时间戳，都要原样保留 */
const TIME_TAG = /^((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)\s*(.*)$/

/** LRC 元信息行，不需要翻译 */
const META_LINE = /^\[(ti|ar|al|by|offset|re|ve|length|kana):/i

/**
 * 这一行是不是 LRC 元信息（[ti:] / [ar:] / [al:] …）。
 *
 * 这里踩过一个隐蔽的坑：`parseLrcLines` 对没有时间戳的行会把**整行**
 * 作为 text 返回，也就是 text 本身就是 `[ti:标题]`。
 * 早先的代码又给它套了一层方括号去匹配（`[${text}]`），
 * 于是正则永远匹配不上 —— 元信息行被当成歌词发去翻译了，
 * 回来就变成「[ti:想象的标题]」，还会白白消耗额度与 token。
 * 直接拿 text 本身去匹配才是对的。
 */
function isMetaLine(text: string): boolean {
  return META_LINE.test(text)
}

type Json = Record<string, any>

function asObj(value: unknown): Json {
  return value && typeof value === 'object' ? (value as Json) : {}
}
function str(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

/** 一行歌词：时间戳前缀 + 文本 */
export interface ParsedLine {
  prefix: string
  text: string
}

/** 翻译结果 */
export interface TranslateResult {
  /** 译文 LRC（与原文同结构） */
  lrc: string
  /** 是否真的产生了翻译。false 表示返回的其实是原文 */
  translated: boolean
  /** 真正被翻译（内容与原文不同）的行数 */
  successCount: number
  /** 总行数 */
  totalCount: number
  /** 失败或降级说明（translated 为 false 时给出原因） */
  error?: string
  /** 是否直接命中的本地缓存（没有消耗接口额度） */
  cached?: boolean
}

/**
 * 探测源语言。
 * MyMemory 不接受 auto，只能自己判断 —— 覆盖几种最常见的非中文歌词语言，
 * 其余按英文处理（拉丁字母歌词绝大多数是英文）。
 */
export function detectSourceLang(text: string): string {
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja' // 日文假名
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(text)) return 'ko' // 韩文
  if (/[\u0400-\u04ff]/.test(text)) return 'ru' // 西里尔字母
  if (/[\u0600-\u06ff]/.test(text)) return 'ar' // 阿拉伯文
  if (/[\u0e00-\u0e7f]/.test(text)) return 'th' // 泰文
  if (/[\u0590-\u05ff]/.test(text)) return 'he' // 希伯来文
  if (looksChinese(text)) return 'zh' // 中文（已是目标语言，无需翻译）
  return 'en'
}

/**
 * 判断是不是中文歌词。
 * 日文、韩文在上面已经先判掉了，走到这里还大量出现汉字的，基本就是中文；
 * 用「汉字占字母总数一半以上」而不是「出现过汉字」，避免英文歌里夹一句
 * 中文标注就被误判成整首中文。
 */
function looksChinese(text: string): boolean {
  const han = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  if (han < 6) return false
  const letters = text.match(/[\p{L}]/gu)?.length ?? 1
  return han / letters >= 0.5
}

/** 比对用归一化：忽略大小写、空白和标点，只留字母数字 */
function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** 把 LRC 拆成「时间戳 + 文本」 */
export function parseLrcLines(lrc: string): ParsedLine[] {
  return lrc.split(/\r?\n/).map((raw) => {
    const match = TIME_TAG.exec(raw.trim())
    if (!match) return { prefix: '', text: raw.trim() }
    return { prefix: match[1], text: match[2].trim() }
  })
}

/** 把译文按原结构拼回 LRC */
export function rebuildLrc(lines: ParsedLine[]): string {
  return lines.map((line) => (line.prefix ? `${line.prefix}${line.text}` : line.text)).join('\n')
}

/** 按字符数分片，只在行边界切开 */
function chunkTexts(texts: string[]): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let size = 0

  for (const text of texts) {
    const cost = text.length + 1
    if (current.length > 0 && size + cost > CHUNK_LIMIT) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(text)
    size += cost
  }
  if (current.length > 0) chunks.push(current)

  return chunks
}

/** MyMemory 的错误提示特征，出现这些说明这次请求不算成功 */
const ERROR_HINT = /QUERY LENGTH LIMIT|INVALID|MYMEMORY WARNING|TOO MANY|IS AN INVALID/i

/**
 * 把接口的英文报错翻成人话。
 *
 * 最要紧的是额度用尽这条：原文是
 * "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY"，
 * 用户看到这句会以为自己账号或 token 被扣了。其实它说的是这个公共接口
 * 按 IP 发的每日免费额度用完了，跟用户的任何账号都无关。必须说清楚。
 */
function friendlyError(raw: string): string {
  if (/USED ALL AVAILABLE FREE TRANSLATIONS/i.test(raw)) {
    const hit = /NEXT AVAILABLE IN\s+(?:(\d+)\s*HOURS?)?\s*(?:(\d+)\s*MINUTES?)?/i.exec(raw)
    const hours = hit?.[1] ? Number(hit[1]) : 0
    const minutes = hit?.[2] ? Number(hit[2]) : 0
    const parts = [hours ? `${hours} 小时` : '', minutes ? `${minutes} 分钟` : ''].filter(Boolean)
    const wait = parts.length ? `，约 ${parts.join(' ')}后恢复` : ''
    return `免费翻译额度今日已用完${wait}。这是翻译接口按 IP 发放的公共额度，不涉及你的任何账号`
  }
  if (/QUERY LENGTH LIMIT/i.test(raw)) return '这段歌词超出接口单次长度上限'
  if (/INVALID SOURCE LANGUAGE/i.test(raw)) return '识别不出这首歌的语言，暂时无法翻译'
  if (/TOO MANY REQUESTS|429/.test(raw)) return '请求过于频繁，请稍后再试'
  return raw.slice(0, 140)
}

/**
 * 翻译一批文本（多行用换行连接，一次请求）。
 * 任何一项校验不过都抛错，由上层决定降级还是放弃。
 */
async function translateChunk(
  texts: string[],
  source: string,
  target: string
): Promise<string[]> {
  const joined = texts.join('\n')
  const url =
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(joined)}` +
    `&langpair=${encodeURIComponent(source)}|${encodeURIComponent(target)}`

  const res = await httpRequest(url, { method: 'GET', timeout: 20000 })
  const body = asObj(res.body)

  // 校验一：responseStatus 才是真相，HTTP 200 不代表成功
  const status = Number(body.responseStatus ?? 0)
  if (status !== 200) {
    throw new Error(friendlyError(str(body.responseDetails) || `翻译服务返回状态 ${status}`))
  }

  const translated = str(asObj(body.responseData).translatedText)

  // 校验二：内容本身可能是错误提示
  if (ERROR_HINT.test(translated)) {
    throw new Error(friendlyError(translated))
  }

  const lines = translated.split('\n')

  // 校验三：行数必须对齐，否则整片作废
  if (lines.length !== texts.length) {
    throw new Error(`行数不匹配（期望 ${texts.length}，得到 ${lines.length}）`)
  }

  return lines
}

/**
 * 翻译整首歌词。
 * @param target 目标语言，默认简体中文
 */
export async function translateLrcDetailed(
  lrc: string,
  target = 'zh-CN'
): Promise<TranslateResult> {
  const lines = parseLrcLines(lrc)

  // 挑出需要翻译的行
  const indexes: number[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const { text } = lines[i]
    if (!text) continue
    if (isMetaLine(text)) continue
    if (!/[\p{L}]/u.test(text)) continue
    indexes.push(i)
  }

  if (indexes.length === 0) {
    return { lrc, translated: false, successCount: 0, totalCount: 0, error: '没有可翻译的歌词内容' }
  }

  const texts = indexes.map((index) => lines[index].text)
  // 用整首歌词判断语言，比逐行判断更准
  const source = detectSourceLang(lrc)

  // 已是中文就别翻了 —— 否则会按英文送去翻译，返回一堆不知所云的东西
  if (source === 'zh' && target.toLowerCase().startsWith('zh')) {
    return {
      lrc,
      translated: false,
      successCount: 0,
      totalCount: texts.length,
      error: '歌词已是中文，无需翻译'
    }
  }

  // 翻过的直接给缓存：公共接口额度按 IP 算，同一首歌不该翻第二次
  const cached = getCachedTranslation(source, target, lrc)
  if (cached) {
    return {
      lrc: cached,
      translated: true,
      successCount: texts.length,
      totalCount: texts.length,
      cached: true
    }
  }

  const translatedTexts: string[] = [...texts]
  let firstError = ''

  const chunks = chunkTexts(texts)
  let cursor = 0

  for (const chunk of chunks) {
    try {
      const out = await translateChunk(chunk, source, target)
      for (let i = 0; i < out.length; i += 1) {
        translatedTexts[cursor + i] = out[i]
      }
    } catch (err) {
      if (!firstError) firstError = err instanceof Error ? err.message : String(err)
      // 整片失败 → 逐行重试，尽量补上
      for (let i = 0; i < chunk.length; i += 1) {
        try {
          const [single] = await translateChunk([chunk[i]], source, target)
          if (single) translatedTexts[cursor + i] = single
        } catch (singleErr) {
          if (!firstError) firstError = singleErr instanceof Error ? singleErr.message : String(singleErr)
        }
      }
    }
    cursor += chunk.length
  }

  // 第二遍：把「原封不动退回来」的行单独再试一次
  const unchanged: number[] = []
  for (let i = 0; i < texts.length; i += 1) {
    if (normalizeForCompare(translatedTexts[i]) === normalizeForCompare(texts[i])) unchanged.push(i)
  }
  for (const index of unchanged.slice(0, RETRY_LIMIT)) {
    try {
      const [single] = await translateChunk([texts[index]], source, target)
      if (single && normalizeForCompare(single) !== normalizeForCompare(texts[index])) {
        translatedTexts[index] = single
      }
    } catch (err) {
      if (!firstError) firstError = err instanceof Error ? err.message : String(err)
    }
  }

  // 写回，并以「内容是否真的变了」来计数 —— 不能拿请求成功冒充翻译成功
  const merged = [...lines]
  let changedCount = 0
  indexes.forEach((lineIndex, i) => {
    const original = lines[lineIndex].text
    if (normalizeForCompare(translatedTexts[i]) !== normalizeForCompare(original)) changedCount += 1
    merged[lineIndex] = { ...lines[lineIndex], text: translatedTexts[i] }
  })

  if (changedCount === 0) {
    // 一行都没翻动 —— 明确报告失败，绝不假装成功
    return {
      lrc,
      translated: false,
      successCount: 0,
      totalCount: texts.length,
      error: firstError || '翻译服务返回的内容与原文一致，未产生译文'
    }
  }

  const kept = texts.length - changedCount
  const finalLrc = rebuildLrc(merged)

  // 只有真的翻出东西才值得缓存，免得把半成品锁死
  putCachedTranslation(source, target, lrc, finalLrc)

  return {
    lrc: finalLrc,
    translated: true,
    successCount: changedCount,
    totalCount: texts.length,
    error: kept > 0 ? `${kept} 行与原文一致（多为专有名词或短句），已保留原文` : undefined
  }
}

/** 简洁封装：只要译文 */
export async function translateLrc(lrc: string, target = 'zh-CN'): Promise<string | null> {
  const result = await translateLrcDetailed(lrc, target)
  return result.translated ? result.lrc : null
}

/**
 * 用 AI 翻译整首歌词。
 *
 * 与公共接口那条链路共用：分句规则、中文短路、本地缓存。
 * 差别只在「谁来翻」——把待翻的行交给大模型，再把结果按原结构拼回 LRC。
 *
 * 缓存键里带上服务商与模型名：换了模型应当允许重新翻一次，
 * 否则用户换了更好的模型却发现译文还是旧的，会以为是坏的。
 */
export async function translateLrcWithAi(
  lrc: string,
  cfg: AiConfig,
  song?: SongContext,
  target = 'zh-CN'
): Promise<{ result: TranslateResult; model: string }> {
  const lines = parseLrcLines(lrc)

  const indexes: number[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const { text } = lines[i]
    if (!text) continue
    if (isMetaLine(text)) continue
    if (!/[\p{L}]/u.test(text)) continue
    indexes.push(i)
  }

  if (indexes.length === 0) {
    return {
      result: { lrc, translated: false, successCount: 0, totalCount: 0, error: '没有可翻译的歌词内容' },
      model: cfg.model
    }
  }

  const texts = indexes.map((index) => lines[index].text)
  const source = detectSourceLang(lrc)

  // 已是中文就别麻烦 AI 了
  if (source === 'zh' && target.toLowerCase().startsWith('zh')) {
    return {
      result: {
        lrc,
        translated: false,
        successCount: 0,
        totalCount: texts.length,
        error: '歌词已是中文，无需翻译'
      },
      model: cfg.model
    }
  }

  const cacheKey = `ai:${cfg.baseUrl}:${cfg.model}:${target}`
  const cached = getCachedTranslation(cacheKey, target, lrc)
  if (cached) {
    return {
      result: {
        lrc: cached,
        translated: true,
        successCount: texts.length,
        totalCount: texts.length,
        cached: true
      },
      model: cfg.model
    }
  }

  const output = await translateLinesWithAi(texts, cfg, song)

  // 与公共接口同样的判定：以「内容是否真的变了」为准，不拿调用成功冒充翻译成功
  const merged = [...lines]
  let changedCount = 0
  indexes.forEach((lineIndex, i) => {
    const translated = output.translations[i] ?? lines[lineIndex].text
    if (normalizeForCompare(translated) !== normalizeForCompare(lines[lineIndex].text)) {
      changedCount += 1
    }
    merged[lineIndex] = { ...lines[lineIndex], text: translated }
  })

  /**
   * 大部分行都只是原文照抄时，也算失败。
   *
   * 只翻了两三行、其余全抄，会一路显示成「翻译成功」，
   * 而界面上只看得见那两行译文 —— 用户的感受就是「翻完了却不显示」。
   * 这里如实报出来，让上层去回退或提示，别让它冒充成功。
   */
  const echoShare = changedCount / Math.max(1, texts.length)
  if (echoShare < 0.5) {
    return {
      result: {
        lrc,
        translated: false,
        successCount: changedCount,
        totalCount: texts.length,
        error:
          changedCount === 0
            ? 'AI 返回的译文与原文一致，未产生翻译'
            : `AI 只翻译了 ${changedCount}/${texts.length} 行，其余照抄了原文，已放弃这次结果`
      },
      model: output.model
    }
  }

  const finalLrc = rebuildLrc(merged)
  putCachedTranslation(cacheKey, target, lrc, finalLrc)

  const kept = texts.length - changedCount
  return {
    result: {
      lrc: finalLrc,
      translated: true,
      successCount: changedCount,
      totalCount: texts.length,
      error: kept > 0 ? `${kept} 行与原文一致，已保留原文` : undefined
    },
    model: output.model
  }
}

/** 对 Lyric 对象做事：返回带翻译的新 Lyric */
export async function translateLyric(lyric: Lyric, target = 'zh-CN'): Promise<Lyric | null> {
  // 平台已经给了翻译就不必再翻
  if (lyric.tlyric && lyric.tlyric.trim()) return lyric

  const source = lyric.lyric || lyric.lxlyric || ''
  if (!source.trim()) return null

  const result = await translateLrcDetailed(source, target)
  if (!result.translated) return null

  return {
    ...lyric,
    tlyric: result.lrc,
    sourceId: `${lyric.sourceId ?? 'builtin'}+translated`
  }
}
