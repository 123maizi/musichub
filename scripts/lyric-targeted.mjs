/**
 * 针对性的歌词验证：修了 QQ 死接口 + 网易 lv=-1 之后，几首主力歌能不能拿到歌词。
 * 直接构造 song 对象（不依赖搜索），避免被 QQ 限流影响判定。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const songs = [
  { name: '晴天', singer: '周杰伦', platform: 'kg', songmid: 'test1' },
  { name: '告白气球', singer: '周杰伦', platform: 'kg', songmid: 'test2' },
  { name: '稻香', singer: '周杰伦', platform: 'tx', songmid: 'test3' },
  { name: '圣诞星', singer: '周杰伦', platform: 'mg', songmid: 'test4' },
  { name: '夜曲', singer: '周杰伦', platform: 'kw', songmid: 'test5' },
  { name: 'Hey Jude', singer: 'The Beatles', platform: 'tx', songmid: 'test6' }
]

const rows = []
for (const s of songs) {
  const t0 = Date.now()
  let r
  try {
    const lyric = await window.api.player.getLyric({
      id: 'probe_' + s.songmid,
      name: s.name,
      singer: s.singer,
      platform: s.platform,
      songmid: s.songmid,
      albumName: '',
      duration: 240,
      qualities: ['320k']
    })
    const text = lyric?.lyric ?? ''
    r = {
      歌: s.name + ' / ' + s.singer,
      耗时: Date.now() - t0,
      有歌词: text.trim().length > 0,
      字数: text.length,
      来源: lyric?.sourceId ?? null,
      首行: text.split('\n').find((l) => l.trim())?.slice(0, 40) ?? null
    }
  } catch (e) {
    r = { 歌: s.name, 耗时: Date.now() - t0, 抛错: String(e.message).slice(0, 80) }
  }
  rows.push(r)
  await sleep(200)
}

return JSON.stringify(
  {
    明细: rows,
    统计: {
      总数: rows.length,
      成功: rows.filter((x) => x.有歌词).length,
      失败: rows.filter((x) => !x.有歌词).length,
      平均耗时: Math.round(rows.reduce((a, b) => a + (b.耗时 || 0), 0) / rows.length)
    }
  },
  null,
  1
)
