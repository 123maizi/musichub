/** 歌词返回结构抽检：确认 lyric 字段到底长什么样、有没有真行 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const search = store('search')
window.location.hash = '#/search'
await sleep(600)
if (search.visibleSongs.length === 0) return { skipped: '没有搜索结果' }

const song = JSON.parse(JSON.stringify(search.visibleSongs[3]))
const lyric = await window.api.player.getLyric(song)
const shape = (v, depth = 0) => {
  if (v === null || v === undefined) return String(v)
  if (typeof v !== 'object') return `${typeof v}:${String(v).length > 40 ? String(v).slice(0, 40) + '...' : v}`
  if (depth > 2) return 'object'
  const o = {}
  for (const [k, val] of Object.entries(v)) o[k] = Array.isArray(val) ? `array(${val.length})` : shape(val, depth + 1)
  return o
}
const raw = lyric?.lyric?.lrc ?? lyric?.lrc ?? lyric?.lyric ?? null
return {
  song: song.name,
  topKeys: lyric ? Object.keys(lyric) : null,
  shape: shape(lyric),
  lrcLength: typeof raw === 'string' ? raw.length : null,
  lrcHead: typeof raw === 'string' ? raw.slice(0, 120) : null,
  lrcLineCount: typeof raw === 'string' ? raw.split('\n').filter((l) => l.trim()).length : null,
  translationLength: typeof lyric?.lyric?.tlyric === 'string' ? lyric.lyric.tlyric.length : null
}
