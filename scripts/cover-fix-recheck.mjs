/** 直接问应用：邓紫棋那 9 首没封面的歌，现在（低负载下）能不能补到 */
const SONGS = [
  '蝶恋花 缘错 歌菲 饭制版',
  'G.E.M.邓紫棋 (夜空中最亮的星 百色DJ俊良)',
  '叙世 (Live)',
  '月半小夜曲 (Live)',
  '飘向北方 (Live片段)',
  '出现又离开 (片段)',
  '怎么办 (片段)',
  '恭喜发财 (改编版片段)',
  '煎熬 (片段)'
]

const out = []
for (const name of SONGS) {
  const t0 = performance.now()
  let url = null
  try {
    url = await window.api.player.resolveCover({
      id: 'probe_' + name,
      platform: 'kw',
      songmid: '0',
      name,
      singer: '邓紫棋',
      albumName: '',
      duration: 200,
      qualities: ['320k']
    })
  } catch (e) {
    url = 'ERR ' + String(e.message).slice(0, 60)
  }
  out.push({ 歌名: name, 结果: url, 耗时ms: Math.round(performance.now() - t0) })
}
return JSON.stringify(out, null, 1)
