/**
 * 歌词严格匹配的代价量化。
 * 取一批不同歌手的歌，看改后有多少能拿到歌词、以及拿到的对不对。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const songs = [
  ['晴天', '周杰伦'],
  ['稻香', '周杰伦'],
  ['告白气球', '周杰伦'],
  ['Hey Jude', 'The Beatles'],
  ['Shape of You', 'Ed Sheeran'],
  ['童话', '光良'],
  ['后来', '刘若英'],
  ['平凡之路', '朴树'],
  ['成都', '赵雷'],
  ['起风了', '买辣椒也用券'],
  ['夜空中最亮的星', '逃跑计划'],
  ['爱你', '王心凌']
]

const rows = []
for (const [name, singer] of songs) {
  const t0 = Date.now()
  let r
  try {
    const lyric = await window.api.player.getLyric({
      id: 'probe_' + name,
      name,
      singer,
      platform: 'tx',
      songmid: 'probe',
      albumName: '',
      duration: 240,
      qualities: ['320k']
    })
    const text = lyric?.lyric ?? ''
    const first = text.split('\n').find((l) => l.trim()) ?? ''
    r = {
      歌: name + ' / ' + singer,
      有歌词: text.trim().length > 0,
      字数: text.length,
      来源: lyric?.sourceId ?? null,
      首行: first.replace(/^\[[\d:.]+\]/, '').trim().slice(0, 40)
    }
  } catch (e) {
    r = { 歌: name, 抛错: String(e.message).slice(0, 60) }
  }
  r.耗时 = Date.now() - t0
  rows.push(r)
  await sleep(250)
}

return JSON.stringify(
  {
    明细: rows,
    统计: {
      总数: rows.length,
      拿到歌词: rows.filter((x) => x.有歌词).length,
      没拿到: rows.filter((x) => x.有歌词 === false).length,
      平均耗时ms: Math.round(rows.reduce((a, b) => a + b.耗时, 0) / rows.length)
    }
  },
  null,
  1
)
