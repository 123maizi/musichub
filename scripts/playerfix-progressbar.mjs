/**
 * player-fix 探针：进度条改造后的呈现层验收。
 *
 * 断言（全部读真实 DOM 的 computed style，不看源码）：
 *   A. 机制：填充不再用内联 width，而是 transform: scaleX(progress/100) + transform-origin left
 *   B. 跳变不出现反向动画：换歌 / 单曲循环归零 / 往回拖 这三种「值向后跳」的瞬间，
 *      不允许出现介于旧值与新值之间的中间帧（那正是「倒着缩回去」）
 *   C. 拖动跟手：拖动过程中填充必须立即跟随滑块（transition 关闭），松手后与 store 一致
 *   D. 圆点：位置由 transform 驱动（不是内联 left），且随进度移动
 *   E. store 的 progress 没有被 CSS 层反向影响
 *
 * 用法：node scripts/cdp-run.mjs <port> scripts/playerfix-progressbar.mjs
 * 注意：cdp-run 会把文件内容塞进模板字符串，这里一律不用反引号。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')

/** 读某个元素的 scaleX：transform 矩阵的 a 分量 */
function scaleOf(el) {
  if (!el) return null
  const t = getComputedStyle(el).transform
  if (!t || t === 'none') return 1
  const m = /matrix\(([^)]+)\)/.exec(t)
  if (!m) return null
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()))
  return parts[0]
}

/** 读 translateX（圆点）：矩阵的 e 分量 */
function translateOf(el) {
  if (!el) return null
  const t = getComputedStyle(el).transform
  if (!t || t === 'none') return 0
  const m = /matrix\(([^)]+)\)/.exec(t)
  if (!m) return null
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()))
  return parts[4]
}

function fillInfo(fillSel, knobSel) {
  const fill = document.querySelector(fillSel)
  const knob = knobSel ? document.querySelector(knobSel) : null
  if (!fill) return null
  const cs = getComputedStyle(fill)
  return {
    内联width: fill.style.width || '',
    内联left: knob ? knob.style.left || '' : null,
    scaleX: +Number(scaleOf(fill)).toFixed(4),
    transformOrigin: cs.transformOrigin,
    transitionProperty: cs.transitionProperty,
    transitionDuration: cs.transitionDuration,
    fillWidthPx: +fill.getBoundingClientRect().width.toFixed(1),
    railWidthPx: +(fill.parentElement?.getBoundingClientRect().width ?? 0).toFixed(1),
    knobTranslateX: knob ? +Number(translateOf(knob)).toFixed(1) : null,
    knobLeft: knob ? getComputedStyle(knob).left : null
  }
}

/** 每帧采样一段，返回序列 */
async function sampleFrames(ms, fillSel) {
  const out = []
  const t0 = performance.now()
  return await new Promise((resolve) => {
    const tick = () => {
      const el = document.querySelector(fillSel)
      out.push({ t: +(performance.now() - t0).toFixed(1), scale: el ? +Number(scaleOf(el)).toFixed(4) : null, dur: el ? getComputedStyle(el).transitionDuration : null })
      if (performance.now() - t0 < ms) requestAnimationFrame(tick)
      else resolve(out)
    }
    requestAnimationFrame(tick)
  })
}

/* ---------------- 准备：播一首歌 ---------------- */
const res = await window.api.search.search({ keyword: '晴天', limit: 10 })
const pool = []
for (const p of res.platforms) for (const s of p.songs) if (s.duration >= 120 && s.duration <= 400) pool.push(s)
const queue = []
for (const s of pool) {
  if (queue.length >= 3) break
  if (queue.some((x) => x.id === s.id)) continue
  try {
    await window.api.player.getUrl({ song: s, quality: '320k' })
    queue.push(s)
  } catch (e) {
    /* 跳过取不到流的 */
  }
}
if (queue.length < 2) return JSON.stringify({ 错误: '可取流的歌不足 2 首' })

await player.play(queue[0], queue)
for (let i = 0; i < 60; i += 1) {
  await sleep(500)
  if (player.playing && player.currentTime > 2) break
}

const out = { 队列: queue.map((s) => s.name + '/' + s.id) }

/* ---------------- A. 机制 ---------------- */
document.querySelector('.progress-track')?.classList.remove('no-motion')
await sleep(600)
out.A_机制 = fillInfo('.progress-fill', '.progress-knob')
out.A_store进度 = +player.progress.toFixed(2)
out.A_填充比例与store一致 = out.A_机制 ? Math.abs(out.A_机制.scaleX * 100 - out.A_store进度) < 0.6 : null
out.A_origin在左 = out.A_机制 ? /^0(px)?\s/.test(out.A_机制.transformOrigin) : null
out.A_无内联width = out.A_机制 ? out.A_机制.内联width === '' : null

/* ---------------- B1. 换歌：不许有反向中间帧 ---------------- */
const beforeJump = out.A_机制.scaleX
const framesSong = await sampleFrames(700, '.progress-fill')
await player.play(queue[1], queue)
const framesAfterPlay = await sampleFrames(900, '.progress-fill')
const seq1 = framesSong.concat(framesAfterPlay).map((f) => f.scale).filter((v) => v !== null)
const lo = Math.min(...seq1.slice(-25))
const hi = Math.max(...seq1.slice(0, 10))
const between1 = seq1.filter((v) => v > lo + 0.02 && v < hi - 0.02).length
out.B1_换歌 = {
  换歌前scale: +hi.toFixed(4),
  换歌后最小scale: +lo.toFixed(4),
  采样帧数: seq1.length,
  '介于两者之间的中间帧数(应为0)': between1,
  跳变当帧的transitionDuration: [...new Set(framesAfterPlay.map((f) => f.dur))],
  序列前12帧: seq1.slice(0, 12).map((v) => +v.toFixed(3))
}

/* 等第二首播起来 */
for (let i = 0; i < 60; i += 1) {
  await sleep(500)
  if (player.playing && player.currentTime > 2) break
}

/* ---------------- C. 拖动跟手 ---------------- */
const input = document.querySelector('.progress-input') ?? document.querySelector('.seek')
if (input) {
  input.value = '70'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(120)
  const during = fillInfo('.progress-fill', '.progress-knob')
  input.value = '25'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(120)
  const during2 = fillInfo('.progress-fill', '.progress-knob')
  input.value = '25'
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(900)
  const after = fillInfo('.progress-fill', '.progress-knob')
  out.C_拖动 = {
    拖到70时scale: during ? during.scaleX : null,
    拖动中transitionDuration: during ? during.transitionDuration : null,
    回拖到25时scale: during2 ? during2.scaleX : null,
    松手后scale: after ? after.scaleX : null,
    松手后store进度: +player.progress.toFixed(2),
    填充与store一致: after ? Math.abs(after.scaleX * 100 - player.progress) < 0.8 : null,
    拖动中跟手: during ? Math.abs(during.scaleX - 0.7) < 0.02 && during2 ? Math.abs(during2.scaleX - 0.25) < 0.02 : null : null
  }
} else {
  out.C_拖动 = { 错误: '找不到进度滑块' }
}

/* ---------------- B2. 单曲循环归零：不许有反向中间帧 ---------------- */
player.mode = 'single'
player.seek(player.duration - 3)
const framesBeforeLoop = await sampleFrames(1500, '.progress-fill')
let restarted = false
const loopFrames = []
for (let i = 0; i < 60; i += 1) {
  const f = await sampleFrames(200, '.progress-fill')
  loopFrames.push(...f)
  if (player.currentTime < 3 && player.playing) {
    restarted = true
    break
  }
  await sleep(200)
}
player.mode = 'order'
const seq2 = framesBeforeLoop.concat(loopFrames).map((f) => f.scale).filter((v) => v !== null)
const top = Math.max(...seq2)
const bottom = Math.min(...seq2)
const between2 = seq2.filter((v, i) => i > 0 && v > bottom + 0.02 && v < top - 0.02 && seq2[i - 1] > v).length
out.B2_单曲循环归零 = {
  是否回到开头: restarted,
  序列最大scale: +top.toFixed(4),
  序列最小scale: +bottom.toFixed(4),
  采样帧数: seq2.length,
  下降过程中的中间帧数: between2,
  结尾12帧: seq2.slice(-12).map((v) => +v.toFixed(3))
}

/* ---------------- D. 圆点 ---------------- */
out.D_圆点 = fillInfo('.progress-fill', '.progress-knob')

/* ---------------- E. store 单调性（CSS 不得反向影响） ---------------- */
const progs = []
for (let i = 0; i < 12; i += 1) {
  await sleep(1000)
  progs.push(+player.progress.toFixed(3))
}
out.E_store进度单调 = progs.every((v, i) => i === 0 || v >= progs[i - 1] - 0.001)
out.E_进度序列 = progs

out.收尾 = { 曲: player.current?.name, playing: player.playing, 错误: player.error }
return JSON.stringify(out, null, 1)
