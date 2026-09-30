/** 歌词链路 API 级抽检：是「这首歌没有歌词」还是「歌词链路坏了」 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const search = store('search')

window.location.hash = '#/search'
await sleep(800)
if (search.visibleSongs.length === 0) return { skipped: '没有搜索结果，先跑一次搜索' }

const picks = [0, 3, 7, 11].map((i) => search.visibleSongs[i]).filter(Boolean)
const results = []
for (const song of picks) {
  try {
    const plain = JSON.parse(JSON.stringify(song))
    const lyric = await window.api.player.getLyric(plain)
    const lines = (lyric?.lyric?.lrc ?? lyric?.lrc ?? '').split('\n').filter((l) => l.trim()).length
    results.push({ name: song.name, platform: song.platform, hasLyric: !!lyric, lines, source: lyric?.sourceName ?? lyric?.sourceId ?? null })
  } catch (err) {
    results.push({ name: song.name, platform: song.platform, error: String(err?.message ?? err).slice(0, 80) })
  }
}
return { picks: results.length, results }
