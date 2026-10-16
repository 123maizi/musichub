/**
 * 翻译链路（自动补齐用到的那个）到底能不能用。
 *
 * 判据：拿一小段三行歌词真跑一次 translateLyric，看返回里有没有 tlyric，
 * 以及失败原因是什么。自动补齐是静默失败的，不单独量一次就分不清
 * 「没触发」和「触发了但翻译失败」。
 */
const api = window.api
const cfg = await api.ai.getConfig().catch((e) => ({ error: String(e) }))
const lyric = {
  lyric: '[00:01.00]Hello world\n[00:05.00]This is a test\n[00:09.00]Goodbye',
  sourceId: 'probe'
}
const started = Date.now()
const result = await api.player
  .translateLyric(lyric, undefined, { id: 'probe-song', name: 'Probe', singer: 'Probe', platform: 'wy' })
  .catch((e) => ({ error: String(e) }))
const ms = Date.now() - started

return JSON.stringify(
  {
    配置: {
      enabled: cfg?.enabled,
      preset: cfg?.preset,
      有Key: Boolean(cfg?.apiKey && String(cfg.apiKey).trim()),
      baseUrl: cfg?.baseUrl,
      model: cfg?.model,
      允许回落到公共接口: cfg?.allowPublicFallback ?? cfg?.fallbackPublic
    },
    翻译耗时ms: ms,
    翻译结果: result
      ? {
          hasLyric: Boolean(result.lyric),
          tlyric: result.lyric?.tlyric ? String(result.lyric.tlyric).slice(0, 120) : null,
          translated: result.translated,
          provider: result.provider,
          lineCount: result.lineCount,
          totalCount: result.totalCount,
          error: result.error ?? null
        }
      : null
  },
  null,
  1
)
