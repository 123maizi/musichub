/**
 * 探针（player-fix）：切歌竞态 —— 迟到的异步结果不许污染当前播放。
 *
 * window.api.player 是 contextBridge 冻死的对象，装不了慢速桩
 * （已测：writable=false / configurable=false / frozen=true），
 * 所以改用真实时序制造迟到：
 *   阶段1：连续 play(A) / play(B)（真实两首不同的歌），各 3 轮，看最终是不是 B；
 *   阶段2：play(伪造 songmid 的 A)（要过一遍全音源，必然慢且大概率失败）
 *          紧跟 play(真的 B)。若没有代次守卫，A 的失败会在几秒后把界面写成
 *          「播放失败」并停掉正在播的 B —— 这就是要抓的迟到写回。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')

const res = await window.api.search.search({ keyword: '晴天', limit: 10 })
const pool = []
for (const p of res.platforms) for (const s of p.songs) if (s.duration >= 150 && s.duration <= 400) pool.push(s)
const picked = []
for (const s of pool) {
  if (picked.length >= 2) break
  if (picked.some((x) => x.id === s.id)) continue
  try {
    await window.api.player.getUrl({ song: s, quality: '320k' })
    picked.push(s)
  } catch {
    /* 跳过取不到流的 */
  }
}
if (picked.length < 2) return JSON.stringify({ 错误: '可取流的歌不足 2 首（需 id 不同）' })
const [a, b] = picked

const out = { 用例A: `${a.name}/${a.id}/${a.duration}s`, 用例B: `${b.name}/${b.id}/${b.duration}s`, 两首id不同: a.id !== b.id }

/* ---------- 阶段1：双击式连点 ---------- */
out.阶段1 = []
for (let i = 0; i < 3; i += 1) {
  const pa = player.play(a)
  const pb = player.play(b)
  await Promise.allSettled([pa, pb])
  await sleep(5000)
  out.阶段1.push({
    轮次: i + 1,
    当前曲id: player.current?.id ?? null,
    期望B: b.id,
    音源: player.urlInfo?.sourceId ?? null,
    播放中: player.playing,
    秒: +player.currentTime.toFixed(2),
    错误: player.error,
    点B放A: player.current?.id !== b.id
  })
}
out.阶段1全部都是B = out.阶段1.every((r) => r.当前曲id === r.期望B)
out.阶段1有没有点B放A = out.阶段1.some((r) => r.点B放A)

/* ---------- 阶段2：迟到的失败不许写回 ---------- */
const bogus = {
  ...a,
  id: `${a.platform}___playerfix_bogus__`,
  songmid: '__playerfix_bogus__',
  hash: '__playerfix_bogus__',
  songId: '__playerfix_bogus__',
  raw: {}
}
const t0 = Date.now()
let aSettled = null
let bSettled = null
const pA = player.play(bogus).then(
  () => {
    aSettled = Date.now() - t0
    return '意外成功'
  },
  (e) => {
    aSettled = Date.now() - t0
    return `失败: ${String(e?.message ?? e).slice(0, 60)}`
  }
)
const pB = player.play(b).then(
  () => {
    bSettled = Date.now() - t0
    return '成功'
  },
  (e) => {
    bSettled = Date.now() - t0
    return `失败: ${String(e?.message ?? e).slice(0, 60)}`
  }
)

/* 观察窗口内持续采样：B 起来之后有没有冒出上一首的错误 / 播放被停掉 */
const watch = []
for (let i = 0; i < 90; i += 1) {
  await sleep(500)
  watch.push({
    ms: Date.now() - t0,
    曲id: player.current?.id ?? null,
    playing: player.playing,
    loading: player.loading,
    错误: player.error,
    秒: +player.currentTime.toFixed(2)
  })
  if (aSettled !== null && bSettled !== null && Date.now() - t0 > (aSettled ?? 0) + 2000) break
}
const ra = await Promise.race([pA, sleep(1).then(() => '未落定')])
const rb = await Promise.race([pB, sleep(1).then(() => '未落定')])

const afterB = watch.filter((w) => bSettled !== null && w.ms > bSettled)
out.阶段2 = {
  A落定ms: aSettled,
  A结果: ra,
  B落定ms: bSettled,
  B结果: rb,
  B落定后有没有出现错误: afterB.some((w) => !!w.错误),
  B落定后错误样例: afterB.find((w) => !!w.错误)?.错误 ?? null,
  B落定后有没有被停掉: afterB.some((w) => !w.playing && w.曲id !== null),
  最终曲id: player.current?.id ?? null,
  最终是B: player.current?.id === b.id,
  最终错误: player.error,
  最终播放中: player.playing,
  最终秒: +player.currentTime.toFixed(2),
  采样: watch.filter((w, i) => i % 4 === 0).map((w) => `${w.ms}ms 曲=${w.曲id} playing=${w.playing} 秒=${w.秒} 错误=${w.错误 ?? '-'}`)
}

out.判据 = {
  阶段1没出现点B放A: !out.阶段1有没有点B放A,
  阶段2B起来后没有上一首的错误: !out.阶段2.B落定后有没有出现错误,
  阶段2B没有被迟到结果停掉: !out.阶段2.B落定后有没有被停掉,
  阶段2最终仍在放B: out.阶段2.最终是B && out.阶段2.最终播放中
}
return JSON.stringify(out, null, 1)
