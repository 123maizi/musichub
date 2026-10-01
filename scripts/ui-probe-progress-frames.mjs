/**
 * 下载页实时进度条「帧数据」探针（task-8 专用）
 *
 * 目的：把「进度条顺不顺」变成可比的数字。改造前（width 驱动）与改造后
 * （transform: scaleX 驱动）用**同一段探针**各跑一次真实下载，直接对差。
 *
 * 采什么：
 *   1. 每一帧（requestAnimationFrame）记录 .bar > i 的
 *      getBoundingClientRect().width（= 用户真正看到的填充像素宽，含 transform）
 *      与 getComputedStyle().transform（矩阵），以及行内百分比文本
 *      → 用于判断「连续推进」还是「跳变」，以及有没有回退帧
 *   2. 帧间隔 dt 的 p50/p95/max → 有没有卡顿
 *   3. PerformanceObserver('longtask') → 有没有长任务（性能红线）
 *   4. .progress-line 四个子元素的 rect → 证明数字文本布局没被搞乱
 *
 * 注意：探针文件由 cdp-run/ui-progress-frames 读取后作为**值**插进模板字符串，
 * 所以这里可以正常使用反引号；但为了与队友的 cdp.mjs 约定一致，一律用拼接。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const out = { steps: {}, aggregates: {} }

/* ---------- 0. 把下载目录钉在隔离 profile 内，绝不碰用户真实下载目录 ---------- */
await window.api.download.setConfig({
  dir: 'F:\\MusicHub\\.tmp-ui\\downloads',
  writeTag: false,
  downloadCover: false,
  downloadLyric: false
})

/* ---------- 1. 造一个真实下载任务 ---------- */
/**
 * 先把已有任务清空。
 * 为什么必须清：行的锚点是歌名，而同一个歌名下可能同时存在好几条任务
 * （前面几轮跑剩下的）。那样 `findRow()` 会在两条行之间漂移，
 * 采到的宽度在 0 与 500 之间来回跳，会被误记成几十次「进度倒放」——
 * 上一轮就出了 88 个假回退帧。清干净之后「只有一条行」，锚点就不会漂。
 */
const old = await window.api.download.list()
if (old.length) await window.api.download.remove(old.map((t) => t.id), false)
out.steps.clearedOld = old.length

// 导航走导航柱（location.hash 在这个外壳里不可靠：hash 变了视图不换）
async function railGo(label, waitMs = 1600) {
  const b = [...document.querySelectorAll('.nav-item')].find(
    (x) => (x.getAttribute('aria-label') || '') === label
  )
  if (b) b.click()
  else location.hash = '#/' + label
  await sleep(waitMs)
}

// 先站到下载页：这样任务一入队，push 事件就能把行渲染出来
await railGo('下载')

/**
 * 页面身份断言 —— 先证明「确实站在下载页」，再谈采样。
 *
 * 上一轮就栽在这：那一轮的下载页其实没挂上（前面的 acceptance 刚把页面带走），
 * 于是「任务行找不到」，而任务在主进程里下得好好的（收了 47MB）——
 * 报出来像是进度条坏了，其实是量错了页面。
 */
{
  const text = document.body.innerText || ''
  const onDownloads = text.includes('下载格式') || text.includes('还没有下载任务')
  out.steps.viewIdentity = {
    hash: location.hash,
    onDownloads,
    head: text.replace(/\s+/g, ' ').slice(0, 70)
  }
  if (!onDownloads) throw new Error('不在下载页：' + JSON.stringify(out.steps.viewIdentity))
}

const res = await window.api.search.search({ keyword: '晴天 周杰伦', limit: 12 })
const all = res.platforms.flatMap((p) => p.songs || [])
/**
 * 挑**时长最长**的那首：这一版探针上一轮失败在「文件太小，行还没渲染出来就下完了」，
 * 采样窗口里根本没有推进过程可测。挑长的能把下载时长拉到十几秒以上。
 */
const song = all.slice().sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))[0] ?? all[0]
if (!song) throw new Error('搜索没有结果，无法发起下载')

out.steps.song = song.name + ' / ' + song.singer + ' / ' + Math.round(song.duration ?? 0) + 's'

const created = await window.api.download.add({
  songs: [JSON.parse(JSON.stringify(song))],
  quality: '320k'
})
const taskId = created[0].id
out.steps.taskId = taskId
out.steps.fileName = created[0].fileName

/* ---------- 2. 立刻开始逐帧采样（不等待行出现，否则 0→100 的整段会跑掉） ---------- */
/**
 * 行是按**歌名**锚定的，不是「第一条 .task」。
 * 上一版就栽在这里：任务下完后列表顺序一变，第一条行换成了别的任务，
 * 采到的宽度从 561 掉回 0，被记成一次「回退帧」—— 那是锚点漂移，不是进度倒放。
 */
const anchor = String(song.name || '').slice(0, 12)

function findRow() {
  const rows = [...document.querySelectorAll('.task')]
  return rows.find((r) => (r.textContent || '').includes(anchor)) ?? null
}

const samples = []
const longTasks = []
try {
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longTasks.push(Number(e.duration.toFixed(1)))
  })
  po.observe({ entryTypes: ['longtask'] })
  window.__ltObserver = po
} catch (err) {
  out.steps.longTaskObserverError = String(err && err.message)
}

let rafId = 0
let last = performance.now()
let sawRow = false
let firstFill = null
const tick = () => {
  const now = performance.now()
  const row = findRow()
  const fill = row ? row.querySelector('.bar > i') : null
  if (fill) {
    sawRow = true
    const cs = getComputedStyle(fill)
    const r = fill.getBoundingClientRect()
    const nums = row.querySelectorAll('.num')
    if (!firstFill) {
      firstFill = {
        inlineStyle: fill.getAttribute('style'),
        cssWidth: cs.width,
        transform: cs.transform,
        transitionProperty: cs.transitionProperty,
        transitionDuration: cs.transitionDuration,
        rowClass: String(row.className)
      }
    }
    samples.push({
      t: Math.round(now),
      dt: Number((now - last).toFixed(2)),
      px: Number(r.width.toFixed(2)),
      tf: cs.transform,
      td: cs.transitionDuration,
      pct: nums.length ? (nums[0].textContent || '').trim() : '',
      cls: String(row.className)
    })
  }
  last = now
  rafId = requestAnimationFrame(tick)
}
rafId = requestAnimationFrame(tick)
out.steps.samplingStartedAt = Math.round(performance.now())

/* ---------- 3. 一直采到任务结束（或 45 秒上限） ---------- */
let endStatus = null
for (let i = 0; i < 90; i += 1) {
  await sleep(500)
  const list = await window.api.download.list()
  const t = list.find((x) => x.id === taskId)
  if (t) {
    endStatus = { status: t.status, progress: Number((t.progress || 0).toFixed(1)), received: t.received }
    if (t.status === 'done' || t.status === 'error') break
  }
}
await sleep(900)
cancelAnimationFrame(rafId)
if (window.__ltObserver) window.__ltObserver.disconnect()

out.steps.sawRow = sawRow
out.steps.firstFill = firstFill
out.steps.endStatus = endStatus
out.steps.samplesTaken = samples.length

// 记录一下「进度归零时过渡是否被关掉」这条规则的真实生效情况
out.steps.zeroProgressRule = (() => {
  const seen = samples.filter((s) => s.pct.startsWith('0.0') || s.pct === '0.0%')
  if (seen.length === 0) return { sampled: 0, note: '采样窗口内没抓到 0% 的帧' }
  const durations = [...new Set(seen.map((s) => s.td))]
  return { sampled: seen.length, transitionDurations: durations, allNone: durations.every((d) => d === '0s') }
})()

/* ---------- 6. 汇总 ---------- */
const dts = samples.map((s) => s.dt).sort((a, b) => a - b)
const q = (p) => (dts.length ? Number(dts[Math.min(dts.length - 1, Math.floor(dts.length * p))].toFixed(2)) : null)

// 相邻帧填充宽度。这里要把两种「宽度变小」分开：
//   · 真实进度回退：百分比也变小了（换源丢弃残留 / 重试重下）—— 必须瞬断，绝不能倒放
//   · 轨道变窄：任务下完的同一帧里行内按钮变多，1fr 那一列变窄，
//     于是「轨道宽 × scale」的乘积暂时小于上一帧，而百分比其实是涨的。
//     这不是进度回退，上一版把它算进「回退帧」里，读数看起来像出了 bug。
const pctNum = (s) => {
  const m = /([\d.]+)\s*%/.exec(s.pct || '')
  return m ? Number(m[1]) : null
}
let backFrames = 0
let steppedFrames = 0
let rewindFrames = 0
const backSteps = []
const widths = samples.map((s) => s.px)
for (let i = 1; i < widths.length; i += 1) {
  const d = Number((widths[i] - widths[i - 1]).toFixed(3))
  if (d < -0.05) {
    backFrames += 1
    const before = pctNum(samples[i - 1])
    const after = pctNum(samples[i])
    const isRewind = before !== null && after !== null && after + 0.05 < before
    if (isRewind) rewindFrames += 1
    if (backSteps.length < 12) {
      backSteps.push({
        类型: isRewind ? '进度回退' : '轨道变窄（同帧按钮变化）',
        从: Number(widths[i - 1].toFixed(1)),
        到: Number(widths[i].toFixed(1)),
        百分比: samples[i - 1].pct + ' → ' + samples[i].pct,
        transitionDuration: samples[i].td,
        行状态: samples[i].cls
      })
    }
  } else if (d > 0.05) {
    steppedFrames += 1
  }
}
const pcts = samples.map((s) => s.pct)
const distinctPct = [...new Set(pcts)]
const rewindDetails = backSteps.filter((b) => b.类型 === '进度回退')

out.aggregates = {
  帧数: samples.length,
  时长ms: samples.length ? samples[samples.length - 1].t - samples[0].t : 0,
  帧间隔_p50: q(0.5),
  帧间隔_p95: q(0.95),
  帧间隔_max: dts.length ? dts[dts.length - 1] : null,
  超过33ms的帧数: dts.filter((d) => d > 33).length,
  超过50ms的帧数: dts.filter((d) => d > 50).length,
  填充宽度_前进帧: steppedFrames,
  填充宽度_回退帧: backFrames,
  /** 真·进度回退帧（百分比确实变小了）：这才是「倒放」的判据 */
  真实进度回退帧: rewindFrames,
  回退帧明细: backSteps,
  回退帧是否都是瞬断: rewindDetails.every((b) => b.transitionDuration === '0s'),
  填充宽度_min: widths.length ? Math.min(...widths) : null,
  填充宽度_max: widths.length ? Math.max(...widths) : null,
  百分比读数种类: distinctPct.length,
  百分比首末: distinctPct.length ? distinctPct[0] + ' → ' + distinctPct[distinctPct.length - 1] : null,
  长任务数: longTasks.length,
  长任务总ms: Number(longTasks.reduce((a, b) => a + b, 0).toFixed(1)),
  长任务明细: longTasks.slice(0, 10)
}

// 原始样本抽稀保存（每 10 帧留 1 帧），避免返回值过大
out.samples = samples.filter((_, i) => i % 10 === 0).slice(0, 200)

/* ---------- 7. 收尾：暂停任务，避免把带宽占满 ---------- */
try {
  await window.api.download.pause([taskId])
  out.steps.paused = true
} catch (err) {
  out.steps.pauseError = String(err && err.message)
}
await sleep(500)

// 顺带记录「进度为 0 的行」的 transition 情况（向后跳要瞬断的判据）
out.steps.zeroProgressTransition = (() => {
  const r = findRow()
  const f = r ? r.querySelector('.bar > i') : null
  if (!f) return null
  const cs = getComputedStyle(f)
  return {
    cls: String(f.className),
    inlineWidth: f.getAttribute('style'),
    transitionDuration: cs.transitionDuration,
    transitionProperty: cs.transitionProperty
  }
})()

return out
