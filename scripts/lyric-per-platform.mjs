/**
 * 逐平台测歌词：同一个关键词，把各平台的搜索结果逐个问一遍歌词。
 * 播放页显示「暂时没有歌词」的那首是酷狗的 —— 那酷狗到底能不能拿到歌词？
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

const res = await window.api.search.search({ keyword: '周杰伦 晴天', limit: 5 })
out['各平台结果'] = res.platforms.map((p) => ({
  平台: p.platform,
  名称: p.providerName,
  条数: p.songs.length,
  错误: p.error ?? null
}))

const rows = []
for (const group of res.platforms) {
  for (const song of group.songs.slice(0, 3)) {
    const t0 = Date.now()
    let r
    try {
      const lyric = await window.api.player.getLyric(song)
      r = {
        平台: song.platform,
        曲名: song.name.slice(0, 24),
        歌手: song.singer.slice(0, 16),
        耗时: Date.now() - t0,
        有歌词: Boolean(lyric?.lyric && lyric.lyric.trim()),
        长度: (lyric?.lyric ?? '').length
      }
    } catch (e) {
      r = {
        平台: song.platform,
        曲名: song.name.slice(0, 24),
        歌手: song.singer.slice(0, 16),
        耗时: Date.now() - t0,
        抛错: String(e.message).slice(0, 90)
      }
    }
    rows.push(r)
    await sleep(150)
  }
}
out['逐首歌词结果'] = rows
out['统计'] = {
  总数: rows.length,
  成功: rows.filter((r) => r.有歌词).length,
  失败: rows.filter((r) => !r.有歌词).length
}

return JSON.stringify(out, null, 1)
