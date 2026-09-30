/**
 * 压缩后歌词链路抽检：直接打 IPC 取歌词，判断「某首歌没有歌词」是内容问题还是链路问题。
 * 注意返回结构是 { lyric: string, tlyric, rlyric, lxlyric, sourceId }。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const search = store('search')

window.location.hash = '#/search'
await sleep(700)
if (search.visibleSongs.length === 0) return { skipped: '没有搜索结果' }

const picks = [0, 3, 7, 11].map((i) => search.visibleSongs[i]).filter(Boolean)
const results = []
for (const song of picks) {
  try {
    const plain = JSON.parse(JSON.stringify(song))
    const lyric = await window.api.player.getLyric(plain)
    const raw = typeof lyric?.lyric === 'string' ? lyric.lyric : ''
    results.push({
      name: song.name,
      platform: song.platform,
      hasLyric: !!lyric,
      lrcChars: raw.length,
      lrcLines: raw.split('\n').filter((l) => l.trim()).length,
      sourceId: lyric?.sourceId ?? null,
      head: raw.slice(0, 40).replace(/\n/g, ' | ')
    })
  } catch (err) {
    results.push({ name: song.name, platform: song.platform, error: String(err?.message ?? err).slice(0, 90) })
  }
}
return { picks: results.length, withLyric: results.filter((r) => r.lrcLines > 0).length, results }
