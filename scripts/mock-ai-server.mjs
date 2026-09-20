/**
 * 模拟一个「OpenAI 兼容」的翻译服务，用来端到端验证 AI 翻译链路。
 *
 * 为什么需要它：验证客户端代码不能依赖真实 API Key ——
 * 既不该让用户掏钱，也不该让测试结果受额度、限流影响。
 * 这里把服务端行为完全掌控住，就能精确验证：
 *   · 请求格式对不对（模型名、temperature、system/user 消息）
 *   · JSON 解析够不够健壮（裹代码块、前后带废话、行数不对）
 *   · 错误能不能翻译成人话（401 / 404 / 429）
 *
 * 用法： node scripts/mock-ai-server.mjs [端口]
 */
import http from 'node:http'

const port = Number(process.argv[2] ?? 8899)

/** 从用户消息里把编号行抠出来 */
function parseLines(userContent) {
  return userContent
    .split('\n')
    .map((line) => /^\d+\.\s?(.*)$/.exec(line.trim())?.[1] ?? null)
    .filter((x) => x !== null)
}

const server = http.createServer((req, res) => {
  const send = (code, obj) => {
    const body = JSON.stringify(obj)
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
    res.end(body)
  }

  if (req.method === 'GET' && req.url === '/models') {
    send(200, {
      object: 'list',
      data: [{ id: 'mock-fast' }, { id: 'mock-quality' }, { id: 'mock-broken' }, { id: 'mock-wrong-count' }, { id: 'mock-prose' }]
    })
    return
  }

  if (req.method === 'POST' && req.url === '/chat/completions') {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      let payload = {}
      try {
        payload = JSON.parse(raw)
      } catch {
        send(400, { error: { message: 'invalid json' } })
        return
      }

      const model = String(payload.model ?? '')
      const auth = req.headers.authorization ?? ''

      // —— 故意制造各种故障，用来验证客户端的错误处理 ——
      // no-auth 一律回 401：专门用来验证「Key 无效」这条提示，
      // 不依赖客户端是否真的没带头（那样测不到）
      if (model === 'no-auth') {
        send(401, { error: { message: 'Authentication Fails, Your api key is invalid' } })
        return
      }
      if (model === 'rate-limited') {
        send(429, { error: { message: 'Rate limit reached' } })
        return
      }
      if (model === 'not-found') {
        send(404, { error: { message: 'model not found' } })
        return
      }

      const userMsg = payload.messages?.find((m) => m.role === 'user')?.content ?? ''
      const lines = parseLines(userMsg)

      // 逐行给出可辨认的「译文」
      const translated = lines.map((line) => `〔译〕${line}`)

      let content
      if (model === 'mock-broken') {
        // 完全不是 JSON
        content = '好的，我帮你翻译好了，但是我不打算按格式输出。'
      } else if (model === 'mock-wrong-count') {
        // 行数对不上：少给一行
        content = JSON.stringify({ translations: translated.slice(0, Math.max(0, translated.length - 1)) })
      } else if (model === 'mock-prose') {
        // 裹在代码块里，前后还有解释文字 —— 真实模型最常见的形态
        content = `下面是翻译结果：\n\`\`\`json\n${JSON.stringify({ translations: translated })}\n\`\`\`\n希望有帮助！`
      } else {
        content = JSON.stringify({ translations: translated })
      }

      send(200, {
        id: 'mock-1',
        object: 'chat.completion',
        model: model || 'mock',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
      })
    })
    return
  }

  send(404, { error: { message: 'not found' } })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`模拟 AI 服务已启动: http://127.0.0.1:${port}`)
  console.log(`  可用模型: mock-fast / mock-quality / mock-broken / mock-wrong-count / mock-prose`)
  console.log(`  故障模拟: 模型名填 no-auth / rate-limited / not-found`)
})
