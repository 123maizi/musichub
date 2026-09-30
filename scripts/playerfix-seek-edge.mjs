/**
 * 探针（player-fix）：seek 边界 —— 负数、超出结尾、结尾附近是否会被误判成播完而切歌。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')

const res = await window.api.search.search({ keyword: '晴天', limit: 10 })
const songs = res.platforms.flatMap((p) => p.songs).filter((s) => s.duration >= 120 && s.duration <= 400)
let song = null
for (const s of songs.slice(0, 8)) {
  try {
    await window.api.player.getUrl({ song: s, quality: '320k' })
    song = s
    break
  } catch {
    /* 跳过 */
  }
}
if (!song) return JSON.stringify({ 错误: '没有可取流的歌' })
await player.play(song, songs.filter((s) => s.duration >= 120 && s.duration <= 400).slice(0, 3))
for (let i = 0; i < 40; i += 1) {
  await sleep(500)
  if (player.playing && player.currentTime > 1) break
}

const out = { 曲id: player.current?.id, 队列长度: player.playlist.length, 总时长: +player.duration.toFixed(1) }

/* 1) 负数 */
player.seek(-5)
await sleep(1200)
out.拖到负数 = { 秒: +player.currentTime.toFixed(2), 进度: +player.progress.toFixed(2), playing: player.playing }

/* 2) 远超结尾 */
player.seek(999999)
await sleep(1500)
out.拖到超远 = { 秒: +player.currentTime.toFixed(2), 进度: +player.progress.toFixed(2), 时长: +player.duration.toFixed(1), playing: player.playing, 错误: player.error }
await sleep(4000)
out.拖到超远_等4秒 = {
  曲id: player.current?.id,
  秒: +player.currentTime.toFixed(2),
  进度: +player.progress.toFixed(2),
  playing: player.playing,
  有没有自动切歌: player.current?.id !== out.曲id,
  错误: player.error
}

/* 3) 回到中间继续听 */
player.seek(30)
player.resume()
await sleep(2500)
out.回到30秒 = { 秒: +player.currentTime.toFixed(2), 进度: +player.progress.toFixed(2), playing: player.playing, 错误: player.error }

/* 4) 按百分比拖到 100% */
player.seekByPercent(100)
await sleep(2500)
out.拖到100百分比 = { 秒: +player.currentTime.toFixed(2), 进度: +player.progress.toFixed(2), playing: player.playing, 有没有自动切歌: player.current?.id !== out.曲id, 错误: player.error }

out.收尾 = { 曲id: player.current?.id, playing: player.playing, 错误: player.error }
return JSON.stringify(out, null, 1)
