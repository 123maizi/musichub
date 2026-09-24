/** 直接测补图接口对酷我歌曲的效果 */
const res = await window.api.search.search({ keyword: '周杰伦', limit: 30 })
const kuwo = res.platforms.flatMap((p) => p.songs).filter((s) => s.platform === 'kw')

const out = []
for (const song of kuwo.slice(0, 8)) {
  const started = Date.now()
  let url = null
  let err = null
  try {
    url = await window.api.player.resolveCover(song)
  } catch (e) {
    err = String(e.message).slice(0, 80)
  }
  out.push({
    歌名: song.name.slice(0, 22),
    歌手: song.singer.slice(0, 14),
    平台自带封面: Boolean(song.picUrl),
    补图结果: url ? String(url).slice(0, 76) : null,
    耗时ms: Date.now() - started,
    错误: err
  })
}

return JSON.stringify(out, null, 1)
