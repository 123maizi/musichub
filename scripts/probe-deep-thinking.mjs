/**
 * 验证翻译新功能：
 *   1. 常驻（keep_alive）——冷启动 vs 热调用的耗时差
 *   2. 深度思考开关——开/关的耗时与质量对比
 *   3. 模型名回显——界面要能显示「本歌词由 xxx 翻译」
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BASE = 'http://127.0.0.1:11434/v1'

const VERSES = {
  快: [
    'Hello darkness, my old friend',
    "I've come to talk with you again"
  ],
  深思: [
    'Because a vision softly creeping',
    'Left its seeds while I was sleeping',
    'And the vision that was planted in my brain',
    'Still remains within the sound of silence'
  ]
}

function lrcOf(lines) {
  return lines.map((t, i) => `[00:${String(i * 5).padStart(2, '0')}.00]${t}`).join('\n')
}

async function translate(label, lines, songName) {
  const song = {
    id: `t_${label}_${Date.now().toString(36)}`,
    platform: 'kw',
    songmid: 't',
    name: songName,
    singer: 'Simon & Garfunkel',
    albumName: 'Sounds of Silence',
    duration: 180,
    qualities: ['320k']
  }
  const started = Date.now()
  const r = await window.api.player.translateLyric(
    { lyric: lrcOf(lines), sourceId: 'probe' },
    'zh-CN',
    song
  )
  const cost = Date.now() - started
  const saved = r.translated ? await window.api.ai.getSaved(song.id) : null
  return {
    模式: label,
    translated: r.translated,
    provider: r.provider,
    providerName: r.providerName,
    耗时ms: cost,
    行数: `${r.lineCount}/${r.totalCount}`,
    译文: (r.lyric?.tlyric ?? '').split('\n').map((l) => l.replace(/^\[[\d:.]+\]/, '')),
    已保存: Boolean(saved),
    落盘的模型名: saved?.providerName ?? null,
    error: r.error
  }
}

const out = {}

/* 先看模型当前在不在显存里 */
const ps0 = await (await fetch('http://127.0.0.1:11434/api/ps')).json()
out['0_开始时显存'] = (ps0.models ?? []).map((m) => m.name)

/* 1. 普通模式（快速） */
await window.api.ai.setConfig({
  enabled: true,
  preset: 'ollama',
  baseUrl: BASE,
  model: 'murasaki:latest',
  apiKey: '',
  disableThinking: true,
  deepThinking: false,
  keepAliveMinutes: 30,
  maxTokens: 1500,
  outputFormat: 'auto',
  temperature: 0.1,
  fallbackToPublic: false
})
out['1_快速模式'] = await translate('快速', VERSES.快, 'The Sound of Silence')

/* 查常驻状态 */
await sleep(500)
const ps1 = await (await fetch('http://127.0.0.1:11434/api/ps')).json()
out['2_调用后显存'] = (ps1.models ?? []).map((m) => ({
  模型: m.name,
  显存GB: (m.size_vram / 1024 ** 3).toFixed(2),
  常驻至: m.expires_at
}))

/* 2. 深度思考模式 */
await window.api.ai.setConfig({ deepThinking: true })
out['3_深度思考'] = await translate('深思', VERSES.深思, 'The Sound of Silence (Deep)')

/* 3. 再切回快速，确认能自动恢复 */
await window.api.ai.setConfig({ deepThinking: false })
out['4_切回快速'] = await translate('快速2', ['Silence like a cancer grows', 'Hear my words that I might teach you'], 'Silence')

out['5_对比'] = {
  '快速模式耗时': out['1_快速模式'].耗时ms + ' ms',
  '深度思考耗时': out['3_深度思考'].耗时ms + ' ms',
  '倍数': (out['3_深度思考'].耗时ms / Math.max(1, out['1_快速模式'].耗时ms)).toFixed(1) + 'x'
}

return JSON.stringify(out, null, 1)
