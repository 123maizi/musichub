/**
 * 探针（player-fix）：进度单调性长时观察 + 监听器是否随播放次数累加。
 *
 * 判据：
 *  1. 同一首歌内 currentTime / progress 只增不减（允许亚秒级抖动）
 *  2. 音源不被无故切换、不出现错误条
 *  3. 播放确实在推进（60 秒里至少走了 50 秒）
 *  4. 多次播放不会让音频元素上的监听器越挂越多
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')

/* 统计音频元素上的监听器：同类型 add/remove 相减，看净数量会不会随播放次数增长 */
if (!window.__pfListenerStats) {
  window.__pfListenerStats = { add: {}, remove: {} }
  const add = HTMLMediaElement.prototype.addEventListener
  const remove = HTMLMediaElement.prototype.removeEventListener
  HTMLMediaElement.prototype.addEventListener = function (type, ...rest) {
    if (this === window.__pfAudio) {
      window.__pfListenerStats.add[type] = (window.__pfListenerStats.add[type] ?? 0) + 1
    }
    return add.call(this, type, ...rest)
  }
  HTMLMediaElement.prototype.removeEventListener = function (type, ...rest) {
    if (this === window.__pfAudio) {
      window.__pfListenerStats.remove[type] = (window.__pfListenerStats.remove[type] ?? 0) + 1
    }
    return remove.call(this, type, ...rest)
  }
}

const res = await window.api.search.search({ keyword: '晴天', limit: 10 })
const songs = res.platforms
  .flatMap((p) => p.songs)
  .filter((s) => s.duration >= 180 && s.duration <= 400)
let song = null
for (const c of songs.slice(0, 8)) {
  try {
    await window.api.player.getUrl({ song: c, quality: '320k' })
    song = c
    break
  } catch {
    /* 换下一首 */
  }
}
if (!song) return JSON.stringify({ 错误: '没有可取流的歌' })

await player.play(song)
for (let i = 0; i < 40; i += 1) {
  await sleep(500)
  if (window.__pfAudio && window.__pfAudio.readyState >= 2 && window.__pfAudio.currentTime > 1) break
}

const samples = []
for (let i = 0; i < 45; i += 1) {
  await sleep(1000)
  samples.push({
    s: i + 1,
    t: +(player.currentTime ?? -1).toFixed(2),
    p: +(player.progress ?? -1).toFixed(3),
    dur: +(player.duration ?? -1).toFixed(1),
    id: player.current?.id ?? null,
    src: player.urlInfo?.sourceId ?? null,
    playing: player.playing,
    err: player.error
  })
}

const times = samples.map((x) => x.t)
const progs = samples.map((x) => x.p)
const backJumps = samples
  .map((x, i) => (i === 0 ? null : +(x.t - samples[i - 1].t).toFixed(2)))
  .filter((d) => d !== null && d < -0.05)

return JSON.stringify(
  {
    曲: song.name,
    曲id: song.id,
    标注时长: song.duration,
    采样数: samples.length,
    起始秒: times[0],
    结束秒: times[times.length - 1],
    秒数回退次数: backJumps.length,
    秒数回退样例: backJumps.slice(0, 5),
    进度回退次数: progs.filter((v, i) => i > 0 && v < progs[i - 1] - 0.001).length,
    进度是否单调: progs.every((v, i) => i === 0 || v >= progs[i - 1] - 0.001),
    播放中的采样数: samples.filter((x) => x.playing).length,
    音源是否被切过: new Set(samples.map((x) => x.src)).size > 1,
    音源: [...new Set(samples.map((x) => x.src))],
    曲目是否被外部切换过: new Set(samples.map((x) => x.id)).size > 1,
    曲目集合: [...new Set(samples.map((x) => x.id))],
    出现过的错误: [...new Set(samples.map((x) => x.err).filter(Boolean))],
    出现过的时长基准: [...new Set(samples.map((x) => x.dur))],
    监听器净增: Object.fromEntries(
      [...new Set([...Object.keys(window.__pfListenerStats.add), ...Object.keys(window.__pfListenerStats.remove)])].map(
        (k) => [k, (window.__pfListenerStats.add[k] ?? 0) - (window.__pfListenerStats.remove[k] ?? 0)]
      )
    ),
    监听器累计add: window.__pfListenerStats.add,
    采样: samples.map((x) => `${x.s}s t=${x.t} p=${x.p} dur=${x.dur} id=${x.id} playing=${x.playing}`)
  },
  null,
  1
)
