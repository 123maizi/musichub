/**
 * 四种任务行状态的构造探针（task-8 专用，第一阶段）
 *
 * 为什么需要：设计审计若跑在空态页面上，任务行、进度条、状态标签、数字文本
 * **全都不在 DOM 里** —— 那种「通过」是假的。
 *
 * 上一版的失败教训：4 条任务并发跑，等我回去看时它们全都下完了，
 * 于是「下载中 / 已暂停」两个状态根本没出现，审计只量到了 done。
 * 现在改成两阶段按状态造：
 *   A 阶段（并发 2，128k 小文件）→ 两条都下完 → done，其中一条留给宿主机删文件造 missing
 *   B 阶段（并发 2，320k 大文件）→ 立刻暂停第一条 → paused；第二条继续跑 → downloading；
 *                                再加第三条排队 → waiting
 * 返回时 B 的下载任务仍在进行中，正好留给审计窗口。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { steps: {} }

function domStates() {
  return [...document.querySelectorAll('.task')].map((r) => {
    const fill = r.querySelector('.bar > i')
    const cs = fill ? getComputedStyle(fill) : null
    return {
      cls: String(r.className),
      name: (r.querySelector('.name')?.textContent || '').trim().slice(0, 24),
      tags: [...r.querySelectorAll('.tag')].map((t) => (t.textContent || '').trim()),
      pct: (r.querySelector('.num')?.textContent || '').trim(),
      fillStyle: fill ? fill.getAttribute('style') || '' : null,
      fillTransform: cs ? cs.transform : null,
      fillWidthPx: fill ? Number(fill.getBoundingClientRect().width.toFixed(2)) : null,
      missing: /文件已丢失/.test(r.textContent || ''),
      ops: [...r.querySelectorAll('.ops button')].map((b) => (b.textContent || '').trim())
    }
  })
}

const waitStatus = async (id, want, timeoutMs) => {
  const t0 = Date.now()
  for (;;) {
    const list = await window.api.download.list()
    const t = list.find((x) => x.id === id)
    if (t && want.includes(t.status)) return t
    if (Date.now() - t0 > timeoutMs) return t ?? null
    await sleep(400)
  }
}

/* ---------- 0. 隔离下载目录 ---------- */
await window.api.download.setConfig({
  dir: 'F:\\MusicHub\\.tmp-ui\\downloads-states',
  concurrency: 2,
  writeTag: false,
  downloadCover: false,
  downloadLyric: false,
  preferQuality: '128k'
})

/* ---------- 1. 清场 ---------- */
const old = await window.api.download.list()
if (old.length) await window.api.download.remove(old.map((t) => t.id), false)
out.steps.clearedOld = old.length

/* ---------- 2. 找歌：小的两条 + 大的两条 ---------- */
const pool = []
for (const kw of ['晴天 周杰伦', '七里香 周杰伦', '夜曲 周杰伦']) {
  const res = await window.api.search.search({ keyword: kw, limit: 15 })
  for (const s of res.platforms.flatMap((p) => p.songs || [])) {
    if (!pool.some((x) => x.name === s.name && x.singer === s.singer)) pool.push(s)
  }
}
if (pool.length < 4) throw new Error('只找到 ' + pool.length + ' 首歌，不足 4 首')
// 时长最长的两条留给 B 阶段（要下得久），短的给 A 阶段
const byDur = pool.slice().sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
const big = byDur.slice(0, 2)
const small = pool.filter((s) => !big.includes(s)).slice(0, 2)
out.steps.picked = { small: small.map((s) => s.name), big: big.map((s) => s.name + ' ' + Math.round(s.duration ?? 0) + 's') }

/* ---------- 3. A 阶段：两条小文件下完 → done ---------- */
const aTasks = await window.api.download.add({
  songs: small.map((s) => JSON.parse(JSON.stringify(s))),
  quality: '128k'
})
const aDone = []
for (const t of aTasks) aDone.push(await waitStatus(t.id, ['done', 'error'], 90000))
out.steps.phaseA = aDone.map((t) => ({ status: t?.status, file: t?.fileName, path: t?.savePath, size: t?.received }))

/* ---------- 4. B 阶段：暂停一条 + 跑一条 + 排一条 ---------- */
const bTasks = await window.api.download.add({
  songs: big.map((s) => JSON.parse(JSON.stringify(s))),
  quality: '320k'
})
// 立刻暂停第一条（此时多半还在 pending/waiting，pause 对这些状态都有效）
await window.api.download.pause([bTasks[0].id])
await sleep(1200)
const paused = await waitStatus(bTasks[0].id, ['paused'], 8000)

// 再排一条进队列，制造 waiting
const extraSong = pool.find((s) => !small.includes(s) && !big.includes(s)) ?? pool[0]
const cTasks = await window.api.download.add({
  songs: [JSON.parse(JSON.stringify(extraSong))],
  quality: '320k'
})
await sleep(1500)

// 让 DownloadView 重新挂载，确保行都在（导航走导航柱：hash 赋值在这个外壳里不可靠）
const railGo = async (label, waitMs) => {
  const b = [...document.querySelectorAll('.nav-item')].find(
    (x) => (x.getAttribute('aria-label') || '') === label
  )
  if (b) b.click()
  else location.hash = '#/' + label
  await sleep(waitMs)
}
await railGo('搜索', 900)
await railGo('下载', 2000)

const listNow = await window.api.download.list()
const byId = (id) => listNow.find((t) => t.id === id)
out.steps.serverStates = listNow.map((t) => {
  const which =
    aTasks.findIndex((x) => x.id === t.id) >= 0
      ? 'A' + aTasks.findIndex((x) => x.id === t.id)
      : bTasks.findIndex((x) => x.id === t.id) >= 0
        ? 'B' + bTasks.findIndex((x) => x.id === t.id)
        : cTasks.findIndex((x) => x.id === t.id) >= 0
          ? 'C0'
          : '?'
  return { which, status: t.status, progress: Number((t.progress || 0).toFixed(1)), received: t.received, file: t.fileName }
})
out.steps.domStates = domStates()
out.steps.statusCensus = out.steps.serverStates.reduce((acc, t) => {
  acc[t.status] = (acc[t.status] ?? 0) + 1
  return acc
}, {})

/* 宿主机要删的文件：A 阶段的第二条 → 第二阶段变成 missing */
out.steps.deleteThisFile = aDone[1]?.savePath ?? null
out.steps.pausedId = paused?.id ?? bTasks[0].id
out.steps.stillDownloading = listNow
  .filter((t) => t.status === 'downloading' || t.status === 'waiting')
  .map((t) => t.id)

return out
