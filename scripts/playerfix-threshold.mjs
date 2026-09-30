/**
 * 探针（player-fix）：误判阈值边界矩阵（判定「明显只有一小段」的两个条件）。
 *
 * 手法：每条用例都先用**指定的平台标注时长**重新播一遍（保证 current.duration 干净），
 * 把进度拖到 20 秒，再伪造 el.duration 并补发 loadedmetadata，观察是否触发换源。
 * 伪造只在事件派发的那一瞬间生效，随后立刻撤销。
 *
 * 用例：
 *   A 250s / 187.5s（0.75×，缺口 62.5s）→ 旧代码不换，新代码也不该换（回归）
 *   B 250s / 175.0s（0.70×，缺口 75.0s）→ 旧代码会换（误判 = 用户遇到的回退）；新代码不该换
 *   D 250s / 225.0s（0.90×，缺口 25.0s）→ 长短差异，不换
 *   E 100s / 55.0s （0.55×，缺口 45.0s）→ 只满足比例、不满足缺口 → 不换
 *   C 250s / 137.5s（0.55×，缺口 112.5s）→ 两个条件都满足 → 必须换源且保住位置
 *   F 250s / 48.5s （原始复现比例，缺口 201.5s）→ 必须换源且保住位置
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')

const res = await window.api.search.search({ keyword: '晴天', limit: 10 })
const songs = res.platforms
  .flatMap((p) => p.songs)
  .filter((s) => s.duration >= 180 && s.duration <= 400)
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
if (!el) return JSON.stringify({ 错误: '没有捕获到 audio 元素，先跑一次播放探针' })

const realGet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration').get
let fake = null
Object.defineProperty(el, 'duration', {
  configurable: true,
  get() {
    return fake === null ? realGet.call(el) : fake
  }
})

/** 每条用例：用指定元数据重播 → 拖到 20 秒 → 伪造时长 → 采样 7 秒 */
async function runCase(name, expectedDuration, actualDuration) {
  await player.play({ ...base, duration: expectedDuration })
  for (let i = 0; i < 60; i += 1) {
    await sleep(500)
    if (el.readyState >= 2 && player.playing) break
  }
  player.seek(20)
  await sleep(1300)

  const before = {
    t: +player.currentTime.toFixed(2),
    p: +player.progress.toFixed(2),
    src: player.urlInfo?.sourceId ?? null,
    dur: +player.duration.toFixed(1),
    元数据时长: player.current?.duration ?? null
  }

  fake = actualDuration
  const readBack = el.duration
  el.dispatchEvent(new Event('loadedmetadata'))
  fake = null

  const seen = []
  for (let i = 0; i < 14; i += 1) {
    await sleep(500)
    seen.push({
      t: +player.currentTime.toFixed(2),
      p: +player.progress.toFixed(2),
      src: player.urlInfo?.sourceId ?? null,
      err: player.error
    })
  }
  const minT = Math.min(...seen.map((x) => x.t))
  const progs = seen.map((x) => x.p)
  return {
    用例: name,
    平台标注: expectedDuration,
    伪造时长: actualDuration,
    比例: +(actualDuration / expectedDuration).toFixed(2),
    缺口秒: +(expectedDuration - actualDuration).toFixed(1),
    伪造是否生效: readBack === actualDuration,
    换源前秒: before.t,
    换源前源: before.src,
    采样最小秒: minT,
    是否被打回起点: minT < Math.max(1, before.t - 5),
    是否换源: seen.some((x) => x.src && x.src !== before.src),
    结果源: [...new Set(seen.map((x) => x.src))],
    采样进度: progs,
    进度是否单调: progs.every((v, i) => i === 0 || v >= progs[i - 1] - 0.001),
    错误: [...new Set(seen.map((x) => x.err).filter(Boolean))],
    最终秒: seen[seen.length - 1].t,
    最终进度: seen[seen.length - 1].p
  }
}

const out = { 曲: base.name, 原始标注: base.duration, 用例: [] }
out.用例.push(await runCase('A 0.75×（缺口 62.5s）：不该换', 250, 187.5))
out.用例.push(await runCase('B 0.70×（缺口 75s，旧版误判点）：不该换', 250, 175))
out.用例.push(await runCase('D 0.90×（缺口 25s）：不该换', 250, 225))
out.用例.push(await runCase('E 0.55×但缺口只有 45s：不该换', 100, 55))
out.用例.push(await runCase('C 0.55×（缺口 112.5s）：该换且保位置', 250, 137.5))
out.用例.push(await runCase('F 0.19×（缺口 201.5s，原始复现比例）：该换且保位置', 250, 48.5))

delete el['duration']
out.判据 = {
  不该换的四条都没换: out.用例.slice(0, 4).every((c) => !c.是否换源),
  该换的两条都换了: out.用例.slice(4).every((c) => c.是否换源),
  换源的两条位置都没被打回: out.用例.slice(4).every((c) => !c.是否被打回起点),
  换源的两条进度都单调: out.用例.slice(4).every((c) => c.进度是否单调),
  全部用例都无错误: out.用例.every((c) => c.错误.length === 0)
}
out.收尾 = { 真实时长: +el.duration.toFixed(1), 当前秒: +player.currentTime.toFixed(2), 播放中: player.playing, 错误: player.error }
return JSON.stringify(out, null, 1)
