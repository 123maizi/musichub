/**
 * 用真实本地模型（Ollama + murasaki）验证完整链路：
 * 配置 → 带歌名的提示词 → 翻译 → 落盘 → 切歌回来还在。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

/* ---------- 1. 选中本地模型 ---------- */
const cfg = await window.api.ai.setConfig({
  enabled: true,
  preset: 'ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'murasaki:latest',
  apiKey: '',
  disableThinking: true,
  maxTokens: 1500,
  outputFormat: 'auto',
  temperature: 0.1,
  fallbackToPublic: true,
  targetLanguage: '简体中文'
})
out['1_配置'] = {
  enabled: cfg.enabled,
  preset: cfg.preset,
  model: cfg.model,
  baseUrl: cfg.baseUrl,
  关思考链: cfg.disableThinking,
  输出格式: cfg.outputFormat
}

/* ---------- 2. 连接测试（应能拿到模型列表） ---------- */
const t0 = Date.now()
const test = await window.api.ai.test()
out['2_连接测试'] = {
  ok: test.ok,
  耗时ms: test.cost ?? Date.now() - t0,
  模型数: test.models?.length ?? 0,
  含murasaki: (test.models ?? []).some((m) => m.includes('murasaki')),
  error: test.error
}

/* ---------- 3. 真实翻译（带歌名上下文） ---------- */
const NONCE = `n${Date.now().toString(36)}`
const LRC = [
  '[ti:Imagine]',
  '[ar:John Lennon]',
  `[00:00.00]Imagine there's no heaven ${NONCE}`,
  `[00:05.50]It's easy if you try ${NONCE}`,
  `[00:11.20]No hell below us ${NONCE}`,
  `[00:16.80]Above us only sky ${NONCE}`,
  `[00:22.40]Imagine all the people ${NONCE}`,
  `[00:28.00]Living for today ${NONCE}`
].join('\n')

const song = {
  id: `test_${NONCE}`,
  platform: 'kw',
  songmid: NONCE,
  name: 'Imagine',
  singer: 'John Lennon',
  albumName: 'Imagine',
  duration: 183,
  qualities: ['320k']
}

const started = Date.now()
const r = await window.api.player.translateLyric({ lyric: LRC, sourceId: 'localtest' }, 'zh-CN', song)
const cost = Date.now() - started

out['3_本地模型翻译'] = {
  translated: r.translated,
  provider: r.provider,
  providerName: r.providerName,
  耗时ms: cost,
  行数: `${r.lineCount}/${r.totalCount}`,
  元信息行未被翻: (r.lyric?.tlyric ?? '').startsWith('[ti:Imagine]'),
  译文: (r.lyric?.tlyric ?? '').split('\n').slice(2, 6),
  error: r.error
}

/* ---------- 4. 译文是否落盘 ---------- */
const saved = await window.api.ai.getSaved(song.id)
out['4_已保存'] = {
  存在: Boolean(saved),
  provider: saved?.provider,
  edited: saved?.edited,
  行数: saved ? saved.tlyric.split('\n').length : 0
}

/* ---------- 5. 模拟「切走再切回来」 ---------- */
await sleep(500)
const savedAgain = await window.api.ai.getSaved(song.id)
out['5_再读一次仍在'] = Boolean(savedAgain && savedAgain.tlyric === saved?.tlyric)

/* ---------- 6. 手工修改后不会被自动翻译覆盖 ---------- */
await window.api.ai.saveTranslation({
  songId: song.id,
  tlyric: '[00:00.00]我手动改的译文',
  provider: 'manual',
  edited: true,
  updatedAt: Date.now()
})
const manual = await window.api.ai.getSaved(song.id)
out['6_手工修改'] = {
  provider: manual?.provider,
  edited: manual?.edited,
  内容: manual?.tlyric
}

/* ---------- 7. 清除 ---------- */
await window.api.ai.deleteSaved(song.id)
out['7_清除后'] = (await window.api.ai.getSaved(song.id)) === null

return JSON.stringify(out, null, 1)
