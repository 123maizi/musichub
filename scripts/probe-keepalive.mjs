/**
 * 测试 Ollama 的 keep_alive：把模型常驻显存能省掉多少时间。
 *
 * 背景：Ollama 默认空闲 5 分钟就把模型从显存卸载。下次翻译要重新加载
 * 2.7GB 权重 —— 实测首次调用比热调用慢好几倍。
 * 如果 keep_alive 能在 OpenAI 兼容接口上生效，这就是最省事的一次优化。
 */
const BASE = 'http://127.0.0.1:11434/v1'
const MODEL = 'murasaki:latest'

async function chat(label, extra = {}) {
  const started = Date.now()
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      stream: false,
      max_tokens: 80,
      think: false,
      messages: [
        { role: 'system', content: '你是翻译。把用户的词翻成中文，只输出译文。' },
        { role: 'user', content: '1. Hello world\n2. Good morning' }
      ],
      ...extra
    })
  })
  const data = await res.json()
  const cost = Date.now() - started
  return {
    方案: label,
    HTTP: res.status,
    耗时ms: cost,
    输出token: data.usage?.completion_tokens ?? 0,
    译文: (data.choices?.[0]?.message?.content ?? '').slice(0, 60).replace(/\n/g, ' | ')
  }
}

/** 查 ollama ps 看模型还在不在显存里 */
async function ps() {
  try {
    const r = await fetch('http://127.0.0.1:11434/api/ps')
    const j = await r.json()
    return (j.models ?? []).map((m) => ({
      模型: m.name,
      显存: `${(m.size_vram / 1024 / 1024 / 1024).toFixed(2)} GB`,
      常驻至: m.expires_at
    }))
  } catch (e) {
    return ['查询失败: ' + e.message]
  }
}

const out = {}
out['1_当前加载状态'] = await ps()
out['2_带keep_alive调用'] = await chat('keep_alive=30m', { keep_alive: '30m' })
out['3_调用后再查'] = await ps()
out['4_热调用（不带参数）'] = await chat('普通调用')
out['5_再查状态'] = await ps()

return JSON.stringify(out, null, 1)
