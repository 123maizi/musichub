/**
 * 压缩后歌词链路重试（上游 QQ 时好时坏，重试几次能区分「链路坏」与「上游抖」）。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const search = store('search')

window.location.hash = '#/search'
await sleep(600)
const byName = (n) => search.visibleSongs.find((s) => s.name.includes(n))
const targets = [byName('稻香'), byName('晴天'), byName('一路向北')].filter(Boolean)

const attempts = []
for (let round = 1; round <= 3; round += 1) {
  for (const song of targets) {
    try {
      const lyric = await window.api.player.getLyric(JSON.parse(JSON.stringify(song)))
      const raw = typeof lyric?.lyric === 'string' ? lyric.lyric : ''
      attempts.push({
        round,
        song: song.name,
        platform: song.platform,
        lines: raw.split('\n').filter((l) => l.trim()).length,
        chars: raw.length,
        sourceId: lyric?.sourceId ?? null,
        firstLine: raw.split('\n').find((l) => /\[\d\d:/.test(l))?.slice(0, 32) ?? null
      })
    } catch (err) {
      attempts.push({ round, song: song.name, error: String(err?.message ?? err).slice(0, 80) })
    }
  }
  await sleep(1500)
}

return {
  targets: targets.map((s) => `${s.name}/${s.platform}`),
  attempts,
  successCount: attempts.filter((a) => (a.lines ?? 0) > 0).length,
  verdict:
    attempts.some((a) => (a.lines ?? 0) > 0)
      ? '压缩后歌词链路可用（上游有时返回空，属外部抖动）'
      : '本轮全部为空 —— 需对照上游直连结果判断'
}
