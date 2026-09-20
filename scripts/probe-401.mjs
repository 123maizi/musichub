/** 单独排查：401 为什么没触发 */
const BASE = 'http://127.0.0.1:8899'

await window.api.ai.setConfig({
  enabled: true,
  preset: 'custom',
  baseUrl: BASE,
  model: 'no-auth',
  apiKey: 'test-key-not-real',
  fallbackToPublic: false
})

const cfg = await window.api.ai.getConfig()

// 直接打一次模拟服务，确认它确实会回 401
let raw
try {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key-not-real' },
    body: JSON.stringify({ model: 'no-auth', messages: [{ role: 'user', content: '1. hello' }] })
  })
  raw = { status: res.status, body: (await res.text()).slice(0, 120) }
} catch (e) {
  raw = { error: String(e.message) }
}

const r = await window.api.player.translateLyric(
  { lyric: "[00:00.00]Unique marker line for 401 test\n[00:03.00]Second line here", sourceId: 'dbg' },
  'zh-CN'
)

return JSON.stringify(
  {
    配置: { enabled: cfg.enabled, model: cfg.model, baseUrl: cfg.baseUrl, key非空: cfg.apiKey.length > 0, 回落: cfg.fallbackToPublic },
    模拟服务直连: raw,
    翻译结果: { translated: r.translated, provider: r.provider, error: r.error, 译文: r.lyric?.tlyric }
  },
  null,
  1
)
