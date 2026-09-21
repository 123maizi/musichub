/**
 * 找出「让本地推理模型老实翻译」的正确姿势。
 *
 * 背景：Murasaki-4B 是 qwen3 架构的推理模型，默认会先写一大段思维链，
 * 6 行歌词硬生生生成了 1.6 万 token 把上下文撑爆。速度本身没问题
 * （57 tok/s），问题在于「怎么让它别想那么多」。
 *
 * 这里横向对比几种约束方式，看哪种又快又出正确 JSON。
 */
const BASE = 'http://127.0.0.1:11434/v1'
const MODEL = 'murasaki:latest'

const LINES = [
  "Imagine there's no heaven",
  "It's easy if you try",
  'No hell below us',
  'Above us only sky',
  'Imagine all the people',
  'Living for today'
]

const SYSTEM = [
  '你是专业的歌词翻译。',
  '把用户给出的每一行歌词翻译成简体中文。',
  '要求：',
  '1. 逐行对应，行数必须与输入完全一致，不合并、不拆分、不增删。',
  '2. 保持歌词的语感和韵律，不要逐字硬译；人名、地名、专有名词可保留原文。',
  '3. 原文已经是目标语言的行，原样返回。',
  '4. 只输出 JSON，不要任何解释文字、不要代码块标记。',
  '输出格式：{"translations": ["第一行译文", "第二行译文", ...]}'
].join('\n')

const baseUser =
  '歌曲信息：《Imagine》 — John Lennon（专辑《Imagine》）\n' +
  '请翻译下面这首歌的歌词：\n' +
  LINES.map((line, i) => `${i + 1}. ${line}`).join('\n')

/** 与应用里一致的宽容解析 */
function parseTranslations(content) {
  const tryParse = (t) => {
    try {
      const p = JSON.parse(t.trim())
      return Array.isArray(p?.translations) ? p.translations : null
    } catch {
      return null
    }
  }
  let arr = tryParse(content)
  if (arr) return arr
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(content)
  if (fence) {
    arr = tryParse(fence[1])
    if (arr) return arr
  }
  const s = content.indexOf('{')
  const e = content.lastIndexOf('}')
  if (s >= 0 && e > s) {
    arr = tryParse(content.slice(s, e + 1))
    if (arr) return arr
  }
  return null
}

async function run(label, { userSuffix = '', maxTokens = 600, think, reasoningEffort }) {
  const body = {
    model: MODEL,
    temperature: 0.3,
    stream: false,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: baseUser + userSuffix }
    ]
  }
  if (think !== undefined) body.think = think
  if (reasoningEffort) body.reasoning_effort = reasoningEffort

  const started = Date.now()
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const text = await res.text()
    const cost = Date.now() - started
    if (!res.ok) {
      return { 方案: label, 失败: `HTTP ${res.status}`, 详情: text.slice(0, 120), 耗时ms: cost }
    }
    const data = JSON.parse(text)
    const content = data.choices?.[0]?.message?.content ?? ''
    const reasoning = data.choices?.[0]?.message?.reasoning_content ?? ''
    const arr = parseTranslations(content)
    const ct = data.usage?.completion_tokens ?? 0
    return {
      方案: label,
      耗时ms: cost,
      输出token: ct,
      速度: `${(ct / (cost / 1000)).toFixed(1)} tok/s`,
      思维链token: reasoning ? reasoning.length : 0,
      JSON合法: Boolean(arr),
      行数: arr ? `${arr.length}/${LINES.length}` : '—',
      首行译文: arr?.[0] ?? content.slice(0, 60).replace(/\n/g, '⏎')
    }
  } catch (err) {
    return { 方案: label, 失败: String(err.message).slice(0, 90), 耗时ms: Date.now() - started }
  }
}

console.log('\n找出正确姿势（每种都限 600 token 上限，防止再次跑飞）')
console.log('='.repeat(76))

const results = []
results.push(await run('A 仅限制 token 上限', { maxTokens: 600 }))
results.push(await run('B 加 /no_think', { userSuffix: '\n/no_think', maxTokens: 600 }))
results.push(await run('C think:false 参数', { think: false, maxTokens: 600 }))
results.push(await run('D think:false + /no_think', { think: false, userSuffix: '\n/no_think', maxTokens: 600 }))

console.log(JSON.stringify(results, null, 1))
console.log('='.repeat(76))
