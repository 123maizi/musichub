/**
 * 让下载队列在审计窗口里保持「有任务在跑」（task-8 专用）
 *
 * 为什么要单独一步：本机带宽太快，一条 320k 的歌三五秒就下完了 ——
 * 等审计脚本跑起来，downloading 早就变成 done，于是「下载中」这个状态
 * 从来没被量到过。这里把并发压到 1 并一次排 4 条长歌：
 *   · 第 1 条 downloading
 *   · 第 2~4 条 waiting
 * 探针立刻返回，审计紧接着跑，窗口里一定两种状态都在。
 */
const out = { steps: {} }

await window.api.download.setConfig({
  dir: 'F:\\MusicHub\\.tmp-ui\\downloads-states',
  concurrency: 1,
  writeTag: false,
  downloadCover: false,
  downloadLyric: false,
  preferQuality: '320k'
})
out.steps.concurrency = 1

const pool = []
for (const kw of ['周杰伦 精选', '陈奕迅', '邓紫棋']) {
  const res = await window.api.search.search({ keyword: kw, limit: 15 })
  for (const s of res.platforms.flatMap((p) => p.songs || [])) {
    if (!pool.some((x) => x.name === s.name && x.singer === s.singer)) pool.push(s)
  }
}
pool.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
const picks = pool.slice(0, 4)
if (picks.length === 0) throw new Error('搜不到可用的歌')

const created = await window.api.download.add({
  songs: picks.map((s) => JSON.parse(JSON.stringify(s))),
  quality: '320k'
})
out.steps.enqueued = created.map((t) => t.fileName)
out.steps.picked = picks.map((s) => s.name + ' ' + Math.round(s.duration ?? 0) + 's')

// 立刻把行带出来（push 事件会 upsert；这里只多等一小会儿，不等下载）
await new Promise((r) => setTimeout(r, 1200))
out.steps.domSnapshot = [...document.querySelectorAll('.task')].map((r) => String(r.className))
out.steps.inFlight = out.steps.domSnapshot.filter((c) => /downloading|waiting|pending/.test(c)).length

return out
