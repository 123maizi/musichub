/**
 * 验证「下载封面」功能。
 * 存到临时目录，不污染用户自己的下载文件夹。
 */
const TEST_DIR = 'F:\\MusicHub\\.tmp\\cover-test'

const res = await window.api.search.search({ keyword: '周杰伦 晴天', limit: 30 })
const all = res.platforms.flatMap((p) => p.songs)

/* 挑三首不同类型的：平台自带封面的、酷我那种没封面的 */
const withPic = all.find((s) => s.picUrl)
const noPic = all.find((s) => !s.picUrl)
const targets = [withPic, noPic].filter(Boolean)

const out = []
for (const song of targets) {
  try {
    const r = await window.api.player.downloadCover(song, TEST_DIR)
    out.push({
      歌名: song.name.slice(0, 20),
      平台: song.platform,
      平台自带封面: Boolean(song.picUrl),
      封面来源: r.from === 'platform' ? '平台' : '跨平台补图',
      落盘: r.path.split('\\').pop(),
      体积KB: Math.round(r.bytes / 1024)
    })
  } catch (e) {
    out.push({
      歌名: song.name.slice(0, 20),
      平台: song.platform,
      平台自带封面: Boolean(song.picUrl),
      错误: String(e.message).slice(0, 90)
    })
  }
}

return JSON.stringify(out, null, 1)
