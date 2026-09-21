/**
 * 给 4B 小模型找一套「又稳又不回抄」的提示词。
 *
 * 前两轮实测的教训：
 *   · JSON 格式 → 2 次挂 1 次（转义处理超出小模型能力）
 *   · 「序号|译文」行式 → 解析稳定，但会原样回抄英文
 * 这一轮试最朴素的写法：不给编号，直接要求逐行输出译文。
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

const SONG_INFO = '这首歌是 John Lennon 的《Imagine》（专辑《Imagine》）。'

/** 方案 1：最朴素 —— 直接要求逐行输出，不要编号 */
function plainMessages(temp) {
  return {
    temperature: temp,
    messages: [
      { role: 'system', content: '你是专业的歌词翻译，译文自然流畅，符合中文歌词的表达习惯。' },
      {
        role: 'user',
        content:
          `${SONG_INFO}\n` +
          '把下面这段歌词逐行翻译成简体中文。\n' +
          '每一行输入对应一行输出，行数必须完全一致。\n' +
          '只输出译文本身，不要编号、不要原文、不要任何解释。\n\n' +
          LINES.join('\n')
      }
    ]
  }
}

/** 方案 2：编号输入 + 编号输出 */
function numberedMessages(temp) {
  return {
    temperature: temp,
    messages: [
      { role: 'system', content: '你是专业的歌词翻译，译文自然流畅，符合中文歌词的表达习惯。' },
      {
        role: 'user',
        content:
          `${SONG_INFO}\n` +
          '把下面这段歌词逐行翻译成简体中文，格式为「序号|译文」。\n' +
          '行数必须完全一致，只输出这些行，不要解释。\n\n' +
          LINES.map((l, i) => `${i + 1}. ${l}`).join('\n')
      }
    ]
  }
}

/** 纯行输出解析 */
function parsePlain(content) {
  const rows = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^```/.test(l))
  return rows.length === LINES.length ? rows : null
}

/** 编号行解析 */
function parseNumbered(content) {
  const out = []
  for (const raw of content.split('\n')) {
    const m = /^\s*(\d+)\s*[|｜.、:：]\s*(.+?)\s*$/.exec(raw)
    if (m) out.push({ i: Number(m[1]), t: m[2] })
  }
  if (out.length !== LINES.length) return null
  for (let i = 0; i < out.length; i += 1) if (out[i].i !== i + 1) return null
  return out.map((x) => x.t)
}

/** 译文有没有真的变化（防回抄） */
function changedCount(arr) {
  if (!arr) return 0
  let n = 0
  for (let i = 0; i < arr.length; i += 1) {
    if (arr[i].replace(/\s+/g, '') !== LINES[i].replace(/\s+/g, '')) n += 1
  }
  return n
}

async function run(label, builder, parser, temp) {
  const started = Date.now()
  const payload = builder(temp)
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      max_tokens: 600,
      think: false,
      ...payload
    })
  })
  const cost = Date.now() - started
  const text = await res.text()
  if (!res.ok) return { 方案: label, 失败: `HTTP ${res.status}`, 耗时ms: cost }
  const data = JSON.parse(text)
  const content = data.choices?.[0]?.message?.content ?? ''
  const arr = parser(content)
  return {
    方案: label,
    耗时ms: cost,
    输出token: data.usage?.completion_tokens ?? 0,
    解析成功: Boolean(arr),
    真的翻译了: arr ? `${changedCount(arr)}/${LINES.length} 行` : '—',
    样例: arr ? arr.slice(0, 2) : content.slice(0, 70).replace(/\n/g, ' ⏎ ')
  }
}

console.log('\n给小模型找稳妥提示词（每次限 600 token，关思考链）')
console.log('='.repeat(76))

const rows = []
for (const round of [1, 2]) {
  rows.push(await run(`朴素·温度0·第${round}次`, plainMessages, parsePlain, 0))
  rows.push(await run(`朴素·温度0.3·第${round}次`, plainMessages, parsePlain, 0.3))
  rows.push(await run(`编号·温度0·第${round}次`, numberedMessages, parseNumbered, 0))
}

console.log(JSON.stringify(rows, null, 1))
console.log('='.repeat(76))
