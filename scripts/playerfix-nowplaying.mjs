/**
 * 探针（player-fix）：正在播放页真的渲染出来了吗 + 点歌词能否跳转。
 * （这一项之前在「别人刚构建过、懒加载 chunk 404」的实例上测不出来，必须构建后立刻跑。）
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const app = document.querySelector('#app').__vue_app__
const pinia = app.config.globalProperties.$pinia
const router = app.config.globalProperties.$router
const player = pinia._s.get('player')

const out = {}

/* 1) 先播一首有歌词的 */
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
await player.play(song)
for (let i = 0; i < 40; i += 1) {
  await sleep(500)
  if (player.lyricLines.length > 0 && player.playing) break
}
out.播放 = { 曲: player.current?.name, 歌词行数: player.lyricLines.length, playing: player.playing }

/* 2) 用 router 跳（和界面上点封面走的是同一条路） */
await router.push('/now-playing')
await sleep(2500)
const dom = {
  hash: location.hash,
  stage: document.querySelectorAll('.stage').length,
  lyricLine: document.querySelectorAll('.lyric-line').length,
  seekFill: document.querySelector('.seek-fill')?.style?.width ?? null,
  progressFill: document.querySelector('.progress-fill')?.style?.width ?? null,
  h1: document.querySelector('h1')?.innerText?.trim() ?? null,
  jump: document.querySelectorAll('.jump').length,
  ctrl: document.querySelectorAll('.ctrl').length,
  翻译按钮: document.querySelector('.translate-btn')?.innerText?.trim() ?? null,
  动态导入失败: (document.querySelector('#app')?.innerText ?? '').includes('Failed to fetch')
}
out.正在播放页 = dom
out.页面真的渲染了 = dom.stage > 0 && dom.lyricLine > 0

/* 3) 点第 5 行歌词 → 应该跳到那一行的时间 */
if (dom.lyricLine > 4 && player.lyricLines.length > 4) {
  const lineIndex = 4
  const target = player.lyricLines[lineIndex].time
  const el = document.querySelectorAll('.lyric-line')[lineIndex]
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await sleep(1200)
  out.点歌词跳转 = {
    目标秒: +target.toFixed(2),
    实际秒: +player.currentTime.toFixed(2),
    偏差: +(player.currentTime - target).toFixed(2),
    playing: player.playing,
    进度条宽度: document.querySelector('.seek-fill')?.style?.width ?? null,
    错误: player.error
  }
}

out.收尾 = { 曲: player.current?.name, playing: player.playing, 错误: player.error }
return JSON.stringify(out, null, 1)
