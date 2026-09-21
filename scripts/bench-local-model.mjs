/**
 * 本地模型实测：能不能跑、跑多快、能不能胜任「严格 JSON 输出的歌词翻译」。
 *
 * 用与应用里**完全一致**的提示词与请求格式，所以结论可以直接外推。
 */
const BASE = 'http://127.0.0.1:11434/v1'
const MODEL = process.argv[2] ?? 'murasaki:latest'

const LINES = [
  "Imagine there's no heaven",
  "It's easy if you try",
  'No hell below us',
  'Above us only sky',
  'Imagine all the people',
  'Living for today'
]

const SONG = { name: 'Imagine', artist: 'John Lennon', album: 'Imagine' }

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

const USER =
  `歌曲信息：《${SONG.name}》 — ${SONG.artist}（专辑《${SONG.album}》）\n` +
  '请翻译下面这首歌的歌词：\n' +
  LINES.map((line, i) => `${i + 1}. ${line}`).join('\n')

async function call(tag) {
  const started = Date.now()
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: USER }
      ]
    })
  })
  const body = await res.json()
  const cost = Date.now() - started

  const content = body.choices?.[0]?.message?.content ?? ''
  const usage = body.usage ?? {}
  const completionTokens = usage.completion_tokens ?? 0

  // 用应用里那套宽容解析来判定成败
  let parsed = null
  try {
    parsed = JSON.parse(content.trim())
  } catch {
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(content)
    if (fence) {
      try {
        parsed = JSON.parse(fence[1].trim())
      } catch {
        /* noop */
      }
    }
    if (!parsed) {
      const s = content.indexOf('{')
      const e = content.lastIndexOf('}')
      if (s >= 0 && e > s) {
        try {
          parsed = JSON.parse(content.slice(s, e + 1))
        } catch {
          /* noop */
        }
      }
    }
  }

  const arr = Array.isArray(parsed?.translations) ? parsed.translations : null

  return {
    轮次: tag,
    耗时ms: cost,
    输出token: completionTokens,
    速度: completionTokens > 0 ? `${(completionTokens / (cost / 1000)).toFixed(1)} tok/s` : '—',
    输出首行: content.split('\n')[0].slice(0, 70),
    JSON可解析: Boolean(parsed),
    行数正确: arr ? arr.length === LINES.length : false,
    行数: arr ? `${arr.length}/${LINES.length}` : '—',
    译文: arr ? arr.slice(0, 3) : null
  }
}

console.log(`\n测试模型：${MODEL}`)
console.log('='.repeat(72))

const results = []
// 第一次调用包含模型加载，单独标出来
for (const tag of ['第1次（含加载）', '第2次', '第3次']) {
  try {
    results.push(await call(tag))
  } catch (err) {
    results.push({ 轮次: tag, 失败: String(err.message).slice(0, 120) })
  }
}

console.log(JSON.stringify(results, null, 1))
console.log('='.repeat(72))
