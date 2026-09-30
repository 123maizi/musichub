/**
 * 探针（player-fix）：单独把「原始复现比例」那条用例（标注 250s / 流 48.5s）跑一遍，
 * 给足 40 秒观察窗口，并记录换源全程。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')

const res = await window.api.search.search({ keyword: '晴天', limit: 10 })
const songs = res.platforms.flatMap((p) => p.songs).filter((s) => s.duration >= 180 && s.duration <= 400)
let base = null
for (const c of songs.slice(0, 8)) {
  try {
    await window.api.player.getUrl({ song: c, quality: '320k' })
    base = c
    break
  } catch {
    /* 换下一首 */
  }
}
if (!base) return JSON.stringify({ 错误: '没有可取流的歌' })

const el = window.__pfAudio
if (!el) return JSON.stringify({ 错误: '没有捕获到 audio 元素' })

await player.play({ ...base, duration: 250 })
for (let i = 0; i < 60; i += 1) {
  await sleep(500)
  if (el.readyState >= 2 && player.playing && player.loading === false) break
}
await sleep(1000)
player.seek(20)
await sleep(1500)

const out = {
  曲: base.name,
  换源前: {
    秒: +player.currentTime.toFixed(2),
    进度: +player.progress.toFixed(2),
    时长: +player.duration.toFixed(1),
    源: player.urlInfo?.sourceId ?? null,
    元素真实时长: +el.duration.toFixed(1),
    readyState: el.readyState,
    playing: player.playing
  }
}

const realGet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration').get
let fake = null
Object.defineProperty(el, 'duration', {
  configurable: true,
  get() {
    return fake === null ? realGet.call(el) : fake
  }
})
fake = 48.5
out.伪造生效 = el.duration === 48.5
el.dispatchEvent(new Event('loadedmetadata'))
fake = null

const samples = []
let switchAt = null
let prevSrc = out.换源前.源
for (let i = 0; i < 80; i += 1) {
  await sleep(500)
  const s = {
    s: +((i + 1) * 0.5).toFixed(1),
    t: +player.currentTime.toFixed(2),
    p: +player.progress.toFixed(2),
    dur: +player.duration.toFixed(1),
    src: player.urlInfo?.sourceId ?? null,
    playing: player.playing,
    err: player.error
  }
  if (s.src && s.src !== prevSrc) {
    switchAt = s
    prevSrc = s.src
  }
  samples.push(s)
}
delete el['duration']

const times = samples.map((x) => x.t)
const progs = samples.map((x) => x.p)
out.判据 = {
  换源前秒: out.换源前.秒,
  采样最小秒: Math.min(...times),
  是否被打回起点: Math.min(...times) < 1,
  换源发生时刻: switchAt ? { 采样: switchAt.s, 秒: switchAt.t, 新源: switchAt.src } : null,
  音源序列: [...new Set([out.换源前.源, ...samples.map((x) => x.src)])],
  最终源: samples[samples.length - 1].src,
  秒数回退次数: times.filter((v, i) => i > 0 && v < times[i - 1] - 0.05).length,
  进度回退次数: progs.filter((v, i) => i > 0 && v < progs[i - 1] - 0.001).length,
  最终秒: times[times.length - 1],
  最终进度: progs[progs.length - 1],
  出现过的错误: [...new Set(samples.map((x) => x.err).filter(Boolean))],
  最终: { 曲: player.current?.name, playing: player.playing, 秒: +player.currentTime.toFixed(2) }
}
out.每4秒采样 = samples.filter((x, i) => i % 8 === 0).map((x) => `${x.s}s t=${x.t} p=${x.p} src=${x.src}`)
return JSON.stringify(out, null, 1)
