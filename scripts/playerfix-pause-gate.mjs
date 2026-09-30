/**
 * 探针（player-fix）：用户暂停期间，片段检测/换源不得自己把歌播起来，也不得挪动进度。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')

const res = await window.api.search.search({ keyword: '晴天', limit: 10 })
const songs = res.platforms.flatMap((p) => p.songs).filter((s) => s.duration >= 180 && s.duration <= 400)
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

const el = window.__pfAudio
await player.play(song)
for (let i = 0; i < 40; i += 1) {
  await sleep(500)
  if (player.playing && el?.readyState >= 2) break
}
player.seek(20)
await sleep(1200)
player.pause()
await sleep(1000)
const before = { 秒: +player.currentTime.toFixed(2), 进度: +player.progress.toFixed(2), playing: player.playing, 源: player.urlInfo?.sourceId ?? null }

/* 伪造「这个源只有 48.5 秒」，并且补发 loadedmetadata */
const realGet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration').get
let fake = null
Object.defineProperty(el, 'duration', {
  configurable: true,
  get() {
    return fake === null ? realGet.call(el) : fake
  }
})
fake = 48.5
el.dispatchEvent(new Event('loadedmetadata'))
fake = null

const seen = []
for (let i = 0; i < 30; i += 1) {
  await sleep(500)
  seen.push({
    t: +player.currentTime.toFixed(2),
    p: +player.progress.toFixed(2),
    src: player.urlInfo?.sourceId ?? null,
    playing: player.playing,
    err: player.error
  })
}
delete el['duration']

return JSON.stringify(
  {
    暂停前: before,
    暂停后_15秒观察: {
      最小秒: Math.min(...seen.map((x) => x.t)),
      最大秒: Math.max(...seen.map((x) => x.t)),
      是否自己开播: seen.some((x) => x.playing),
      是否挪动了位置: Math.abs(seen[seen.length - 1].t - before.秒) > 1,
      是否换源: seen.some((x) => x.src && x.src !== before.源),
      错误: [...new Set(seen.map((x) => x.err).filter(Boolean))],
      最终: { 秒: seen[seen.length - 1].t, 进度: seen[seen.length - 1].p, playing: seen[seen.length - 1].playing }
    },
    采样: seen.filter((x, i) => i % 5 === 0).map((x) => `t=${x.t} p=${x.p} playing=${x.playing} src=${x.src}`)
  },
  null,
  1
)
