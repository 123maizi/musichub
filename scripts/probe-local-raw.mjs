/**
 * 打印本地模型对「应用实际发出的提示词」的原始回复。
 * 用来判断：它到底翻译了、回抄了、还是答非所问。
 */
const BASE = 'http://127.0.0.1:11434/v1'
const MODEL = 'murasaki:latest'

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

const SYSTEM_LINES = SYSTEM.replace(
  '4. 只输出 JSON，不要任何解释文字、不要代码块标记。\n输出格式：{"translations": ["第一行译文", "第二行译文", ...]}',
  '4. 严格按「序号|译文」逐行输出，不要编号之外的任何文字，不要空行。\n示例：\n1|第一行的译文\n2|第二行的译文'
)

const INFO = '这首歌是 《Imagine》，演唱：John Lennon，专辑：《Imagine》。请结合这个背景来翻译，让人名、专有名词更准确。'

const cleanLines = [
  "Imagine there's no heaven",
  "It's easy if you try",
  'No hell below us',
  'Above us only sky',
  'Imagine all the people',
  'Living for today'
]

const nonce = 'nmuatfmmc'
const dirtyLines = cleanLines.map((l) => `${l} ${nonce}`)

async function run(label, system, lines) {
  const user =
    `${INFO}\n\n请翻译下面这首歌的歌词：\n` + lines.map((l, i) => `${i + 1}. ${l}`).join('\n')

  const started = Date.now()
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      stream: false,
      max_tokens: 600,
      think: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  })
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content ?? ''
  return {
    方案: label,
    耗时ms: Date.now() - started,
    输出token: data.usage?.completion_tokens ?? 0,
    原始输出: content.slice(0, 400)
  }
}

const rows = []
rows.push(await run('JSON + 干净歌词', SYSTEM, cleanLines))
rows.push(await run('JSON + 带随机后缀', SYSTEM, dirtyLines))
rows.push(await run('行式 + 干净歌词', SYSTEM_LINES, cleanLines))
rows.push(await run('行式 + 带随机后缀', SYSTEM_LINES, dirtyLines))

return JSON.stringify(rows, null, 1)
