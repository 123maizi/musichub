/**
 * 对照实验：歌词接口调用到底会不会在主进程日志里留痕？
 * 如果会 —— 那「日志里一条歌词记录都没有」就说明歌词请求压根没发出去。
 * 如果不会 —— 我之前的推断作废，得换方向查。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

const res = await window.api.search.search({ keyword: '周杰伦 晴天', limit: 5 })
const song = res.platforms.flatMap((p) => p.songs)[0]
out['测试歌曲'] = song ? { 曲名: song.name, 平台: song.platform, songmid: song.songmid } : '无'

if (song) {
  const t0 = Date.now()
  try {
    const lyric = await window.api.player.getLyric(song)
    out['直接调用getLyric'] = {
      耗时ms: Date.now() - t0,
      有歌词: Boolean(lyric?.lyric),
      长度: (lyric?.lyric ?? '').length,
      有译文: Boolean(lyric?.tlyric)
    }
  } catch (e) {
    out['直接调用getLyric'] = { 耗时ms: Date.now() - t0, 抛错: String(e.message).slice(0, 150) }
  }
}

await sleep(600)

// 播放页当前实际状态
window.location.hash = '#/now-playing'
await sleep(3500)
out['播放页'] = await (async () => {
  const line = document.querySelector('.lyric-line')
  const empty = document.querySelector('.lyric-empty')
  return {
    路由: location.hash,
    曲名: document.querySelector('.meta h1')?.innerText?.trim() ?? null,
    歌手: document.querySelector('.sub')?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 40) ?? null,
    歌词行数: document.querySelectorAll('.lyric-line').length,
    空态文案: empty ? empty.innerText.replace(/\s+/g, ' ').trim().slice(0, 70) : null,
    有播放条: Boolean(document.querySelector('.time-row') || document.querySelector('.progress-row'))
  }
})()

out['标记'] = '现在去看主进程日志有没有新增歌词记录'

return JSON.stringify(out, null, 1)
