/**
 * 「下载进行中关闭窗口」探针（task-3 硬边界场景）
 *
 * 场景：用户点了下载，几百 MB 的歌还没下完，直接点右上角关闭。
 * 这是最容易留下悬挂写句柄（.part 文件）、未中止 fetch、
 * 未落盘任务记录的场合 —— 也正是「孤儿进程」投诉里最常见的操作序列。
 *
 * 探针只负责把下载**发起**出去就立刻返回；随后的关窗由测量器执行，
 * 所以关窗时刻正好落在下载中途。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { steps: {} }

try {
  await window.api.download.setConfig({
    dir: 'F:\\MusicHub\\.tmp-lifecycle\\downloads-inflight',
    writeTag: false,
    downloadCover: false,
    downloadLyric: false
  })

  const res = await window.api.search.search({ keyword: '晴天 周杰伦', limit: 10 })
  const all = res.platforms.flatMap((p) => p.songs ?? [])
  const song = all.find((s) => s.platform === 'tx') ?? all[0]
  if (!song) throw new Error('搜索没有结果，无法发起下载')

  const tasks = await window.api.download.add({
    songs: [JSON.parse(JSON.stringify(song))],
    quality: '320k'
  })
  out.steps.added = { id: tasks[0].id, file: tasks[0].fileName, song: song.name }

  // 等到确实进入 downloading（有字节落地）再返回，保证关窗时写句柄是打开的
  let mid = null
  for (let i = 0; i < 25; i += 1) {
    await sleep(400)
    const list = await window.api.download.list()
    const t = list.find((x) => x.id === tasks[0].id)
    if (t && t.status === 'downloading' && t.received > 0) {
      mid = { status: t.status, received: t.received, progress: +(t.progress ?? 0).toFixed(1) }
      break
    }
    if (t && (t.status === 'done' || t.status === 'error')) {
      mid = { status: t.status, note: '下载在关窗前就结束了（文件太小）' }
      break
    }
  }
  out.steps.inFlight = mid ?? { status: 'unknown', note: '25 次轮询内没看到 downloading' }
  out.ok = true
} catch (err) {
  out.ok = false
  out.error = String(err && err.message)
}
return out
