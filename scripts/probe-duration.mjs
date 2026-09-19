/**
 * 验证「进度条按元数据时长换算」这个根因。
 *
 * 做法：搜几首歌 → 取流 → 用 <audio> 加载真实地址 → 对比
 *   「搜索接口给的时长」 vs 「音频流的真实时长」
 *
 * 如果真实时长明显更短，那么用户按进度条拖到 90% 时，
 * 目标位置早就越过结尾了 —— 浏览器会立刻判定播放结束，
 * 于是顺序播放模式下切歌、单曲循环模式下从头开始。
 * 这正是「拖动进度条有概率切歌/重播」的来源。
 */
const list = await window.api.search.search({ keyword: '蛋堡', limit: 20 })
const songs = list.platforms.flatMap((p) => p.songs).slice(0, 6)

const rows = []
for (const song of songs) {
  const row = { name: song.name, meta: song.duration, real: null, diff: null, err: null }
  try {
    const res = await window.api.player.getUrl({ song, quality: '320k' })
    row.real = await new Promise((resolve) => {
      const a = document.createElement('audio')
      a.preload = 'metadata'
      const t = setTimeout(() => resolve(null), 8000)
      a.onloadedmetadata = () => {
        clearTimeout(t)
        resolve(Math.round(a.duration))
      }
      a.onerror = () => {
        clearTimeout(t)
        resolve(null)
      }
      a.src = res.url
    })
    if (row.real && row.meta) row.diff = row.real - row.meta
  } catch (e) {
    row.err = String(e.message).slice(0, 60)
  }
  rows.push(row)
}

return JSON.stringify(
  {
    rows,
    // 差得越多，拖进度条越容易「越过结尾」
    worst: rows.reduce((m, r) => (r.diff !== null && r.diff < m ? r.diff : m), 0)
  },
  null,
  1
)
