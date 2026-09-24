/**
 * 音源体检 v2
 *   · 先等音源全部装载完（27 个脚本要时间）
 *   · 只测「声明支持这首歌所在平台」的源，避免拿不支持的源去测、白判失败
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* 1. 等音源装载完：连续两次数量一致才算稳定 */
let prev = -1
let sources = []
for (let i = 0; i < 40; i += 1) {
  await sleep(1500)
  sources = await window.api.source.list()
  const ready = sources.filter((s) => s.status === 'ready').length
  if (ready === prev && ready > 0) break
  prev = ready
}

const ready = sources.filter((s) => s.status === 'ready')
const failed = sources.filter((s) => s.status !== 'ready')

/* 2. 基准歌：挑一首热门原唱 */
const res = await window.api.search.search({ keyword: '周杰伦 晴天', limit: 30 })
const all = res.platforms.flatMap((p) => p.songs)
const song = all.find((s) => s.platform === 'kg') ?? all[0]

/* 3. 只测支持该平台的源 */
const capable = ready.filter((s) => (s.platforms ?? []).includes(song.platform))

const rows = []
for (const src of capable.slice(0, 14)) {
  const started = Date.now()
  const row = { 音源: src.name.slice(0, 22), 平台: (src.platforms ?? []).join('/'), 判定: '' }
  try {
    const r = await window.api.player.getUrl({ song, quality: '320k', sourceIds: [src.id] })
    const url = String(r.url ?? '')
    if (!/^https?:\/\//i.test(url)) {
      row.判定 = '✗ 地址不是链接'
    } else {
      const probe = await window.api.player.probe(url)
      if (probe?.size && song.duration > 0) {
        const est = Math.round((probe.size * 8) / (320 * 1000))
        const ratio = est / song.duration
        row.估算时长秒 = est
        row.体积KB = Math.round(probe.size / 1024)
        row.判定 = ratio >= 0.75 ? '✓ 完整' : ratio >= 0.2 ? '⚠ 疑似片段' : '✗ 明显是片段'
      } else {
        row.判定 = '? 拿不到体积'
      }
    }
  } catch (err) {
    row.判定 = `✗ ${String(err.message).replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 50)}`
  }
  row.耗时秒 = Math.round((Date.now() - started) / 1000)
  rows.push(row)
}

return JSON.stringify(
  {
    音源总数: sources.length,
    已就绪: ready.length,
    未就绪: failed.length,
    支持该平台的源: capable.length,
    基准歌曲: `${song.name} - ${song.singer} · ${song.platform} · ${song.duration} 秒`,
    统计: {
      完整: rows.filter((r) => r.判定.startsWith('✓')).length,
      疑似片段: rows.filter((r) => r.判定.startsWith('⚠')).length,
      失败: rows.filter((r) => r.判定.startsWith('✗')).length
    },
    清单: rows.map((r) => `${r.判定.padEnd(10)} ${String(r.耗时秒).padStart(3)}s  ${r.音源}`)
  },
  null,
  1
)
