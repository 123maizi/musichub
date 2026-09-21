/**
 * 对比两种输出格式在 4B 本地模型上的稳定性。
 *
 * 结论导向：JSON 要求模型处理字符串转义（"\n" 之类），小模型经常翻车
 * —— 实测它会把 6 行全塞进一个字符串里。行式格式没有转义问题，
 * 解析也简单，可能更适合。
 */
const BASE = 'http://127.0.0.1:11434/v1'
const MODEL = 'murasaki:latest'

const LINES = [
  "Imagine there's no heaven",
  "It's easy if you try",
  'No hell below us',
  'Above us only sky',
  'Imagine all the people',
  'Living for today',
  'You may say I am a dreamer',
  'But I am not the only one'
]

const SONG_INFO = '歌曲信息：《Imagine》 — John Lennon（专辑《Imagine》）'

function jsonSystem() {
  return [
    '你是专业的歌词翻译。',
    '把用户给出的每一行歌词翻译成简体中文。',
    '要求：',
    '1. 逐行对应，行数必须与输入完全一致，不合并、不拆分、不增删。',
    '2. 保持歌词的语感和韵律，不要逐字硬译。',
    '3. 只输出 JSON，不要任何解释文字、不要代码块标记。',
    '输出格式：{"translations": ["第一行译文", "第二行译文", ...]}'
  ].join('\n')
}

function lineSystem() {
  return [
    '你是专业的歌词翻译。',
    '把用户给出的每一行歌词翻译成简体中文。',
    '要求：',
    '1. 每行输入对应一行输出，行数必须完全一致，不合并、不拆分、不增删。',
    '2. 保持歌词的语感和韵律，不要逐字硬译。',
    '3. 输出格式固定为「序号|译文」，不要编号之外的解释文字，不要空行。',
    '示例：',
    '1|第一行的译文',
    '2|第二行的译文'
  ].join('\n')
}

const userOf = (info) =>
  `${info}\n请翻译下面这首歌的歌词：\n` + LINES.map((line, i) => `${i + 1}. ${line}`).join('\n')

function parseJson(content) {
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
  if (s >= 0 && e > s) return tryParse(content.slice(s, e + 1))
  return null
}

function parseLines(content, expected) {
  const out = []
  for (const raw of content.split('\n')) {
    const m = /^\s*(\d+)\s*[|｜.、:：]\s*(.+?)\s*$/.exec(raw)
    if (m) out.push({ index: Number(m[1]), text: m[2] })
  }
  if (out.length !== expected) return null
  // 序号必须严格递增且从 1 开始，防止模型乱序或多给
  for (let i = 0; i < out.length; i += 1) {
    if (out[i].index !== i + 1) return null
  }
  return out.map((x) => x.text)
}

async function run(label, { system, parse, maxTokens = 700 }) {
  const started = Date.now()
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      stream: false,
      max_tokens: maxTokens,
      think: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userOf(SONG_INFO) }
      ]
    })
  })
  const cost = Date.now() - started
  const text = await res.text()
  if (!res.ok) return { 方案: label, 失败: `HTTP ${res.status}`, 耗时ms: cost }

  const data = JSON.parse(text)
  const content = data.choices?.[0]?.message?.content ?? ''
  const ct = data.usage?.completion_tokens ?? 0
  const arr = parse(content, LINES.length)

  return {
    方案: label,
    耗时ms: cost,
    输出token: ct,
    解析成功: Boolean(arr),
    行数: arr ? `${arr.length}/${LINES.length}` : '—',
    样例: arr ? arr.slice(0, 3) : content.slice(0, 90).replace(/\n/g, ' ⏎ ')
  }
}

console.log('\n格式对比（think:false，8 行歌词，每种跑 2 次）')
console.log('='.repeat(76))

const rows = []
for (let round = 1; round <= 2; round += 1) {
  rows.push(await run(`JSON 第${round}次`, { system: jsonSystem(), parse: (c) => parseJson(c) }))
  rows.push(await run(`行式 第${round}次`, { system: lineSystem(), parse: parseLines }))
}

console.log(JSON.stringify(rows, null, 1))
console.log('='.repeat(76))
