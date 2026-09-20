/**
 * 端到端验证 AI 歌词翻译：设置 → IPC → 大模型 → 拼回 LRC。
 * 全部打向本地模拟服务，不碰任何真实 API Key。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BASE = 'http://127.0.0.1:8899'

/**
 * 每次运行都换一段歌词。
 *
 * 译文是会被缓存的（这是功能的一部分），如果每次都拿同一段歌词去测，
 * 第二次开始全都命中缓存、根本不发请求 —— 那样测的就不是链路，
 * 而是缓存。这个坑我已经踩过一次，差点把「缓存命中」误判成「401 没生效」。
 */
const NONCE = `nonce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const LRC = `[ti:Test Song]
[ar:Mock Artist]
[00:00.00]Imagine there's no heaven ${NONCE}
[00:05.50]It's easy if you try ${NONCE}
[00:11.20]No hell below us ${NONCE}
[00:16.80]Above us only sky ${NONCE}`

const out = {}
out['0_本轮标记'] = NONCE

/* ---------- 1. 配置并测试连接 ---------- */
await window.api.ai.setConfig({
  enabled: true,
  preset: 'custom',
  baseUrl: BASE,
  model: 'mock-fast',
  apiKey: 'test-key-not-real',
  fallbackToPublic: false,
  targetLanguage: '简体中文'
})
const cfgBack = await window.api.ai.getConfig()
out['1_配置回读'] = {
  enabled: cfgBack.enabled,
  baseUrl: cfgBack.baseUrl,
  model: cfgBack.model,
  key非空: cfgBack.apiKey === 'test-key-not-real'
}

const test = await window.api.ai.test()
out['2_连接测试'] = { ok: test.ok, endpoint: test.endpoint, 模型数: test.models?.length ?? 0, 耗时ms: test.cost }

/* ---------- 2. 正常翻译 ---------- */
const r1 = await window.api.player.translateLyric(
  { lyric: LRC, sourceId: 'mock' },
  'zh-CN'
)
out['3_正常翻译'] = {
  translated: r1.translated,
  provider: r1.provider,
  providerName: r1.providerName,
  行数: `${r1.lineCount}/${r1.totalCount}`,
  时间戳保留: /\[00:00\.00\]/.test(r1.lyric?.tlyric ?? ''),
  译文: (r1.lyric?.tlyric ?? '').split('\n').slice(0, 3)
}

/* ---------- 3. 模型输出裹在代码块里 ---------- */
await window.api.ai.setConfig({ model: 'mock-prose' })
const r2 = await window.api.player.translateLyric({ lyric: LRC, sourceId: 'mock2' }, 'zh-CN')
out['4_输出带代码块和废话'] = {
  translated: r2.translated,
  行数: `${r2.lineCount}/${r2.totalCount}`,
  首行: (r2.lyric?.tlyric ?? '').split('\n')[0]
}

/* ---------- 4. 行数对不上 ---------- */
await window.api.ai.setConfig({ model: 'mock-wrong-count' })
const r3 = await window.api.player.translateLyric({ lyric: LRC, sourceId: 'mock3' }, 'zh-CN')
out['5_行数对不上'] = { translated: r3.translated, error: r3.error }

/* ---------- 5. 完全不是 JSON ---------- */
await window.api.ai.setConfig({ model: 'mock-broken' })
const r4 = await window.api.player.translateLyric({ lyric: LRC, sourceId: 'mock4' }, 'zh-CN')
out['6_不是JSON'] = { translated: r4.translated, error: r4.error }

/* ---------- 6. 各种服务端错误 ---------- */
for (const [label, model] of [
  ['7_401Key无效', 'no-auth'],
  ['8_限流429', 'rate-limited'],
  ['9_模型不存在404', 'not-found']
]) {
  // 这里必须带上 Key：不带的话按「未配置 AI」处理，根本走不到 401 那条分支
  await window.api.ai.setConfig({ model, apiKey: 'test-key-not-real' })
  const r = await window.api.player.translateLyric({ lyric: LRC, sourceId: label }, 'zh-CN')
  out[label] = { translated: r.translated, error: r.error }
}

/* ---------- 7. 地址写错 ---------- */
await window.api.ai.setConfig({ baseUrl: 'http://127.0.0.1:59999', model: 'mock-fast', apiKey: 'x' })
const r5 = await window.api.player.translateLyric({ lyric: LRC, sourceId: 'mock5' }, 'zh-CN')
out['10_地址不通'] = { translated: r5.translated, error: r5.error }

/* ---------- 8. 中文歌词应当短路，不必打扰 AI ---------- */
await window.api.ai.setConfig({ baseUrl: BASE, model: 'mock-fast', apiKey: 'x' })
const r6 = await window.api.player.translateLyric(
  { lyric: '[00:00.00]我曾经跨过山和大海\n[00:03.00]也穿过人山人海', sourceId: 'zh' },
  'zh-CN'
)
out['11_中文短路'] = { translated: r6.translated, error: r6.error }

/* ---------- 9. 关掉 AI 后应当走内置接口 ---------- */
await window.api.ai.setConfig({ enabled: false })
const r7 = await window.api.player.translateLyric({ lyric: LRC, sourceId: 'mock6' }, 'zh-CN')
out['12_关闭AI'] = { provider: r7.provider, translated: r7.translated, error: (r7.error ?? '').slice(0, 60) }

return JSON.stringify(out, null, 1)
