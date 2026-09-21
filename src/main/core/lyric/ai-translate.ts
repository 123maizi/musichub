/**
 * AI 歌词翻译
 *
 * 为什么值得单独做一条链路：
 * 公共免费接口（MyMemory）额度按 IP 算，翻几首就见底，而且短句经常原样退回。
 * 让用户接自己的 AI，质量和额度都可控 —— 尤其歌词这种讲究语感的东西，
 * 大模型的译文明显更顺。
 *
 * 协议只实现「OpenAI 兼容」一种：DeepSeek / OpenAI / Kimi / 智谱 / 通义 /
 * 硅基流动 / Ollama 本地全都是这一套，一次适配全都能用。
 *
 * 两个必须处理的现实问题：
 *
 *  1. **模型不一定老实输出 JSON**。就算提示词里写明「只输出 JSON」，
 *     它也可能裹一层 ```json 代码块，或者在前后加一句解释。
 *     所以解析要能从一堆文本里把 JSON 抠出来，而不是直接 JSON.parse。
 *
 *  2. **行数必须对得上**。译文按行对应回 LRC，少一行或多一行都会整体错位，
 *     那比不翻译还糟。所以逐项校验：必须是数组、长度一致、元素是字符串；
 *     任何一项不满足就整批判为失败，交给上层决定回退。
 */
import type { AiConfig } from '@shared/types/ai'
import { httpRequest } from '../net/http'

/** 单次请求最多翻多少行（超长歌词分片，避免被截断） */
const MAX_LINES_PER_CHUNK = 60

/** 传给模型的歌曲信息 —— 有上下文，译文明显更准 */
export interface SongContext {
  name?: string
  singer?: string
  album?: string
}

export interface AiTranslationOutput {
  /** 与输入等长的译文数组 */
  translations: string[]
  /** 实际使用的模型 */
  model: string
  /** token 用量（部分服务商返回） */
  usage?: { prompt: number; completion: number }
  /** 分片数量，便于界面说明「翻了 N 批」 */
  chunks: number
  /** 实际生效的输出格式（auto 模式下可能是回退后的行式） */
  format: 'json' | 'lines'
}

/**
 * 归一化接口地址。
 *
 * 用户粘贴的形态五花八门：末尾带斜杠、带 /v1、甚至直接把
 * `.../chat/completions` 整个贴进来。这里统一收成「base」，
 * 后面再拼一次即可，免得出现 `.../v1/v1/chat/completions` 这种。
 */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '')
  url = url.replace(/\/chat\/completions$/i, '')
  url = url.replace(/\/completions$/i, '')
  return url
}

/** 把配置里的错误翻成人话 —— 原文太容易让人误判（比如把限流当成 key 错） */
function friendlyAiError(status: number, bodyText: string): string {
  const lower = bodyText.toLowerCase()

  if (status === 401 || lower.includes('invalid_api_key') || lower.includes('unauthorized')) {
    return 'API Key 无效或已过期，请到服务商后台确认'
  }
  if (status === 402 || lower.includes('insufficient') || lower.includes('quota')) {
    return '账户额度不足，请到服务商后台充值'
  }
  if (status === 404) {
    return '接口地址或模型名不对（404）—— 检查 base URL 是否需要带 /v1，以及模型名是否存在'
  }
  if (status === 429 || lower.includes('rate limit')) {
    return '请求太频繁被限流了，稍等一下再试'
  }
  if (status >= 500) {
    return `服务商暂时故障（HTTP ${status}），可以稍后重试或换个服务商`
  }
  // 尽量把服务端给的原因带出来，比只报状态码有用得多
  const detail = bodyText.replace(/\s+/g, ' ').slice(0, 160)
  return detail ? `HTTP ${status}：${detail}` : `请求失败（HTTP ${status}）`
}

/**
 * 网络层面的失败也要说人话。
 * 原样抛出 `fetch failed` 对用户毫无信息量 —— 看不出是地址写错、
 * 断网，还是本地服务没启动。
 */
function friendlyNetworkError(err: unknown, baseUrl: string): Error {
  const message = err instanceof Error ? err.message : String(err)
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT/i.test(message)) {
    return new Error(
      `连不上 ${baseUrl} —— 检查地址是否写对、本机网络是否通、本地服务是否已启动`
    )
  }
  if (/aborted|timeout/i.test(message)) {
    return new Error(`请求超时（${baseUrl}）—— 可以在设置里把超时时间调大一些`)
  }
  return err instanceof Error ? err : new Error(message)
}

/** 从模型输出里抠出 JSON 对象 */
function extractJson(text: string): unknown {
  const trimmed = text.trim()

  // 1) 直接就是合法 JSON
  try {
    return JSON.parse(trimmed)
  } catch {
    /* 继续尝试 */
  }

  // 2) 被 ```json 包起来（最常见）
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fence) {
    try {
      return JSON.parse(fence[1].trim())
    } catch {
      /* 继续尝试 */
    }
  }

  // 3) 前后带解释文字：取第一个 { 到最后一个 }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      /* 放弃 */
    }
  }

  // 4) 退一步：直接是数组
  const arrStart = trimmed.indexOf('[')
  const arrEnd = trimmed.lastIndexOf(']')
  if (arrStart >= 0 && arrEnd > arrStart) {
    try {
      return JSON.parse(trimmed.slice(arrStart, arrEnd + 1))
    } catch {
      /* 放弃 */
    }
  }

  return null
}

/** 从解析结果里取出译文数组（兼容几种常见字段名） */
function pickTranslations(parsed: unknown): string[] | null {
  if (Array.isArray(parsed)) {
    return parsed.every((x) => typeof x === 'string') ? (parsed as string[]) : null
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    for (const key of ['translations', 'translation', 'lines', 'result', 'lyrics']) {
      const value = obj[key]
      if (Array.isArray(value) && value.every((x) => typeof x === 'string')) {
        return value as string[]
      }
      // 有的模型会返回单个字符串，行间用换行分隔
      if (typeof value === 'string' && value.includes('\n')) {
        return value.split('\n')
      }
    }
  }
  return null
}

/**
 * 组装歌曲信息行。
 *
 * 把歌名 / 歌手 / 专辑告诉模型，译文会明显更准 ——
 * 没有上下文时，模型不知道「Imagine」是歌名还是动词，
 * 也不知道整首歌唱的是什么，只能一行一行硬译。
 */
function songInfoLine(song?: SongContext): string {
  if (!song) return ''
  const parts: string[] = []
  if (song.name) parts.push(`《${song.name}》`)
  if (song.singer) parts.push(`演唱：${song.singer}`)
  if (song.album) parts.push(`专辑：《${song.album}》`)
  if (parts.length === 0) return ''
  return `这首歌是 ${parts.join('，')}。请结合这个背景来翻译，让人名、专有名词更准确。`
}

/** 行式解析：「序号|译文」，对不擅长 JSON 的小模型友好得多 */
function parseNumberedLines(content: string, expected: number): string[] | null {
  const rows: { index: number; text: string }[] = []
  for (const raw of content.split('\n')) {
    const m = /^\s*(\d+)\s*[|｜.、:：]\s*(.+?)\s*$/.exec(raw)
    if (m) rows.push({ index: Number(m[1]), text: m[2] })
  }
  if (rows.length !== expected) return null
  // 序号必须从 1 开始严格递增：顺序错了，贴回歌词就会整体错位
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].index !== i + 1) return null
  }
  return rows.map((r) => r.text)
}

/** 组装提示词 */
function buildMessages(
  lines: string[],
  cfg: AiConfig,
  song: SongContext | undefined,
  format: 'json' | 'lines'
): { system: string; user: string } {
  const target = cfg.targetLanguage || '简体中文'
  const info = songInfoLine(song)

  /**
   * 行式是给小模型用的，提示词必须**极简**。
   *
   * 这一条是实测换来的：同一份长提示词（4 条要求 + JSON 示例）喂给 4B 模型，
   * 它会原样回抄英文、只加个编号就算完成；换成下面这种两句话的写法，
   * 它才老老实实翻译。小模型的指令跟随能力有限，要求列得越多越容易跑偏 ——
   * 对它们来说，「说清楚要什么」比「把注意事项列全」管用。
   */
  if (format === 'lines') {
    return {
      system: `你是专业的歌词翻译，译文自然流畅，符合${target}歌词的表达习惯。`,
      user:
        (info ? `${info}\n` : '') +
        `把下面这段歌词逐行翻译成${target}，格式为「序号|译文」。\n` +
        '行数必须完全一致，只输出这些行，不要解释。\n\n' +
        lines.map((line, i) => `${i + 1}. ${line}`).join('\n')
    }
  }

  const system = [
    '你是专业的歌词翻译。',
    `把用户给出的每一行歌词翻译成${target}。`,
    '要求：',
    '1. 逐行对应，行数必须与输入完全一致，不合并、不拆分、不增删。',
    '2. 保持歌词的语感和韵律，不要逐字硬译；人名、地名、专有名词可保留原文。',
    '3. 原文已经是目标语言的行，原样返回。',
    '4. 只输出 JSON，不要任何解释文字、不要代码块标记。',
    '输出格式：{"translations": ["第一行译文", "第二行译文", ...]}'
  ].join('\n')

  const user =
    (info ? `${info}\n\n` : '') +
    '请翻译下面这首歌的歌词：\n' +
    lines.map((line, i) => `${i + 1}. ${line}`).join('\n')

  return { system, user }
}

/** 调一次接口，翻一批 */
async function translateChunk(
  lines: string[],
  cfg: AiConfig,
  baseUrl: string,
  song: SongContext | undefined,
  format: 'json' | 'lines'
): Promise<{ translations: string[]; model: string; usage?: AiTranslationOutput['usage'] }> {
  const { system, user } = buildMessages(lines, cfg, song, format)
  const endpoint = `${baseUrl}/chat/completions`

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.apiKey.trim()) headers.Authorization = `Bearer ${cfg.apiKey.trim()}`

  const payload: Record<string, unknown> = {
    model: cfg.model,
    temperature: cfg.temperature,
    stream: false,
    // 安全阀：模型一旦「不会停」，没有上限就会一直生成到把上下文撑爆
    max_tokens: cfg.maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  }
  /**
   * 关闭思考链。
   * 这是 Ollama 的扩展字段，兼容 OpenAI 的服务会忽略它；
   * 但对本地推理模型是必须的 —— 实测不关的话，6 行歌词能生成 1.6 万 token。
   */
  if (cfg.disableThinking) payload.think = false

  let res
  try {
    res = await httpRequest(endpoint, {
      method: 'POST',
      headers,
      timeout: cfg.timeoutMs,
      body: payload
    })
  } catch (err) {
    // 网络层失败也翻译成人话，别把 fetch failed 直接甩给用户
    throw friendlyNetworkError(err, baseUrl)
  }

  const bodyText = typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? '')

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(friendlyAiError(res.statusCode, bodyText))
  }

  const body = (typeof res.body === 'object' && res.body !== null
    ? res.body
    : {}) as Record<string, any>

  const content: string =
    body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text ?? ''
  if (!content.trim()) {
    throw new Error('AI 返回了空内容，可能是模型名不对或被内容策略拦了')
  }

  const usage = body.usage
    ? { prompt: Number(body.usage.prompt_tokens ?? 0), completion: Number(body.usage.completion_tokens ?? 0) }
    : undefined

  // 按要求的格式解析；行数不一致一律作废 —— 错位比不翻更糟
  const translations =
    format === 'json'
      ? pickTranslations(extractJson(content))
      : parseNumberedLines(content, lines.length)

  if (!translations) {
    throw new Error(
      format === 'json'
        ? 'AI 的输出不是预期的 JSON 格式，无法解析出译文'
        : 'AI 的输出不是「序号|译文」格式，无法解析出译文'
    )
  }

  if (translations.length !== lines.length) {
    throw new Error(
      `AI 返回的行数对不上（期望 ${lines.length} 行，得到 ${translations.length} 行），已放弃这批结果`
    )
  }

  return { translations, model: String(body.model ?? cfg.model), usage }
}

/**
 * 翻译整首歌的歌词行（只传需要翻译的行文本，调用方负责拼回 LRC）。
 *
 * `auto` 模式下先按 JSON 来，解析失败**自动改用行式重试一次**：
 * 大模型两者都行，而小模型处理 JSON 转义很吃力（实测 4B 模型 2 次挂 1 次），
 * 行式对它们友好得多 —— 这样同一套代码既能伺候云端大模型，也能伺候本地小模型。
 */
export async function translateLinesWithAi(
  lines: string[],
  cfg: AiConfig,
  song?: SongContext
): Promise<AiTranslationOutput> {
  const baseUrl = normalizeBaseUrl(cfg.baseUrl)
  if (!baseUrl) throw new Error('还没填接口地址')
  if (!cfg.model.trim()) throw new Error('还没填模型名')
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('接口地址必须以 http:// 或 https:// 开头')

  const order: ('json' | 'lines')[] =
    cfg.outputFormat === 'lines' ? ['lines'] : cfg.outputFormat === 'json' ? ['json'] : ['json', 'lines']

  const out: string[] = []
  let model = cfg.model
  let usage: AiTranslationOutput['usage']
  let chunks = 0
  let usedFormat: 'json' | 'lines' = order[0]
  let lastError: Error | null = null

  for (let i = 0; i < lines.length; i += MAX_LINES_PER_CHUNK) {
    const slice = lines.slice(i, i + MAX_LINES_PER_CHUNK)
    let done: { translations: string[]; model: string; usage?: AiTranslationOutput['usage'] } | null = null

    for (const format of order) {
      try {
        done = await translateChunk(slice, cfg, baseUrl, song, format)
        usedFormat = format
        break
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        // 网络 / 鉴权 / 额度这类错误，重试另一种格式也没意义，直接抛出去
        if (/Key 无效|额度|限流|连不上|超时|地址或模型名/.test(e.message)) throw e
        lastError = e
      }
    }

    if (!done) throw lastError ?? new Error('AI 翻译失败')

    out.push(...done.translations)
    model = done.model
    chunks += 1
    if (done.usage) {
      usage = {
        prompt: (usage?.prompt ?? 0) + done.usage.prompt,
        completion: (usage?.completion ?? 0) + done.usage.completion
      }
    }
  }

  return { translations: out, model, usage, chunks, format: usedFormat }
}

/**
 * 测试连接。
 *
 * 顺带拉一次 /models —— 模型名换代很快，让界面能列出真实可用的名字，
 * 比让人去抄文档靠谱。拉不到也不算失败，能用 chat 接口就够了。
 */
export async function testAiConnection(cfg: AiConfig): Promise<{
  ok: boolean
  endpoint?: string
  models?: string[]
  cost?: number
  error?: string
}> {
  const baseUrl = normalizeBaseUrl(cfg.baseUrl)
  const endpoint = baseUrl ? `${baseUrl}/chat/completions` : ''

  if (!baseUrl) return { ok: false, error: '还没填接口地址' }
  if (!/^https?:\/\//i.test(baseUrl)) return { ok: false, error: '接口地址必须以 http:// 或 https:// 开头' }

  const started = Date.now()
  try {
    // 先用一句最短的话打通链路，确认 key 与模型名都能用
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cfg.apiKey.trim()) headers.Authorization = `Bearer ${cfg.apiKey.trim()}`

    const testBody: Record<string, unknown> = {
      model: cfg.model,
      temperature: 0,
      stream: false,
      // 测试连接也要设上限并关思考链：本地推理模型不关的话，
      // 一句「ping」能让它想上几分钟，看起来就像卡死了
      max_tokens: 16,
      messages: [{ role: 'user', content: 'ping' }]
    }
    if (cfg.disableThinking) testBody.think = false

    const res = await httpRequest(endpoint, {
      method: 'POST',
      headers,
      timeout: Math.min(cfg.timeoutMs, 30000),
      body: testBody
    })

    const bodyText = typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? '')
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return { ok: false, endpoint, error: friendlyAiError(res.statusCode, bodyText) }
    }

    // 再顺手拉一次模型列表（失败不影响结论）
    let models: string[] | undefined
    try {
      const listRes = await httpRequest(`${baseUrl}/models`, {
        method: 'GET',
        headers: cfg.apiKey.trim() ? { Authorization: `Bearer ${cfg.apiKey.trim()}` } : {},
        timeout: 15000
      })
      const list = typeof listRes.body === 'object' && listRes.body !== null
        ? (listRes.body as Record<string, any>)
        : {}
      if (Array.isArray(list.data)) {
        models = list.data
          .map((m: Record<string, unknown>) => String(m.id ?? ''))
          .filter(Boolean)
          .sort()
      }
    } catch {
      /* 拿不到列表不影响连接测试的结论 */
    }

    return { ok: true, endpoint, models, cost: Date.now() - started }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 网络层面的失败也翻译一下，原文（fetch failed）对用户毫无信息量
    const friendly = /fetch failed|ENOTFOUND|ECONNREFUSED|timeout|aborted/i.test(message)
      ? `连不上 ${baseUrl} —— 检查地址是否正确、本机能否访问该服务${cfg.preset === 'ollama' ? '（Ollama 是否已启动？）' : ''}`
      : message
    return { ok: false, endpoint, error: friendly }
  }
}
