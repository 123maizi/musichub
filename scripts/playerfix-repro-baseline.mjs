/**
 * 探针（player-fix）：复现「进度条回退」根因。
 *
 * 手法：正常播一首歌，把进度拖到 20 秒，然后**只在这一刻**把 el.duration
 * 伪装成 48.5 秒并补发一次 loadedmetadata —— 等价于「音源其实是 48 秒试听片段」。
 * verifyDuration 随后会做它平时做的事：上报坏源 + 自动换源重播。
 *
 * 判据：换源瞬间 currentTime 是否被打回 0（进度条回退）。
 * 采样全程只读，不改播放器状态（伪装值在事件派发后立刻撤销）。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')

/** 采样一次播放器状态 */
const snap = (tag) => ({
  tag,
  t: +(player.currentTime ?? -1).toFixed(2),
  progress: +(player.progress ?? -1).toFixed(2),
  duration: +(player.duration ?? -1).toFixed(1),
  源: player.urlInfo?.sourceId ?? null,
  源名: player.urlInfo?.sourceName ?? null,
  曲: player.current?.name ?? null,
  标注时长: player.current?.duration ?? null,
  loading: player.loading,
  playing: player.playing,
  错误: player.error
})

const out = { 步骤: [] }

/* 1) 取一首歌（走真实搜索 IPC），先确认这首歌真的能取到流 */
const res = await window.api.search.search({ keyword: '晴天', limit: 10 })
const songs = res.platforms
  .flatMap((p) => p.songs)
  .filter((s) => s.duration >= 180 && s.duration <= 400)
let song = null
for (const candidate of songs.slice(0, 8)) {
  try {
    await window.api.player.getUrl({ song: candidate, quality: '320k' })
    song = candidate
    break
  } catch {
    /* 换下一首候选 */
  }
}
if (!song) return JSON.stringify({ 错误: '没有拿到可取流的歌', 平台: res.platforms.map((p) => [p.platform, p.songs.length]) })
out.选中 = { 曲: song.name, 歌手: song.singer, 平台: song.platform, 标注时长: song.duration }

/* 2) 播放并拖到 20 秒 */
await player.play(song)
for (let i = 0; i < 40; i += 1) {
  await sleep(500)
  if (window.__pfAudio && window.__pfAudio.readyState >= 2) break
}
await sleep(1500)
player.seek(20)
await sleep(1500)
out.换源前 = snap('换源前')
out.audio换源前 = window.__pfAudio
  ? { readyState: window.__pfAudio.readyState, paused: window.__pfAudio.paused, 真实时长: +(window.__pfAudio.duration ?? -1).toFixed(1) }
  : null

/* 3) 伪装「这个音源只有 48.5 秒」 */
const el = window.__pfAudio
if (!el) return JSON.stringify({ ...out, 错误: '没有捕获到 audio 元素' })

const realGet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration').get
let fake = false
Object.defineProperty(el, 'duration', {
  configurable: true,
  get() {
    return fake ? 48.5 : realGet.call(el)
  }
})
fake = true
el.dispatchEvent(new Event('loadedmetadata'))
fake = false
out.伪装值 = 48.5
out.派发后立即 = snap('派发后立即')

/* 4) 观察 40 秒：进度会不会被打回 0；换源本身可能要十几秒才完成 */
for (let i = 0; i < 80; i += 1) {
  await sleep(500)
  out.步骤.push(snap(`+${((i + 1) * 0.5).toFixed(1)}s`))
}

/* 5) 撤掉伪装，恢复真实读数 */
delete el['duration']
out.撤掉伪装后 = snap('撤掉伪装后')
out.audio最终 = { readyState: el.readyState, paused: el.paused, 真实时长: +(el.duration ?? -1).toFixed(1) }

const times = out.步骤.map((s) => s.t)
out.判据 = {
  换源前秒数: out.换源前.t,
  采样最小秒数: Math.min(...times),
  是否被打回起点: Math.min(...times) < 1,
  是否出现过错误提示: out.步骤.some((s) => !!s.错误),
  错误样例: out.步骤.find((s) => !!s.错误)?.错误 ?? null,
  音源是否换过: out.步骤.some((s) => s.源 && s.源 !== out.换源前.源),
  最终秒数: times[times.length - 1],
  进度是否单调: out.步骤.every((s, i) => i === 0 || s.progress >= out.步骤[i - 1].progress - 0.01)
}

return JSON.stringify(out, null, 1)
