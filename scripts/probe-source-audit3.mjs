/**
 * 换平台再测一遍：确认那些失败的源是「彻底死了」还是「只是不支持酷狗」。
 * 同时对比「自动择优」与「逐个指定」的结果差异。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

/** 每个平台挑一首基准歌 */
const PLATFORMS = [
  { id: 'wy', kw: '周杰伦 晴天' },
  { id: 'tx', kw: '周杰伦 晴天' },
  { id: 'kw', kw: '周杰伦 晴天' }
]

const result = {}

for (const p of PLATFORMS) {
  const res = await window.api.search.search({ keyword: p.kw, limit: 30 })
  const song = res.platforms.flatMap((x) => x.songs).find((s) => s.platform === p.id)
  if (!song) {
    result[p.id] = '没有搜到该平台的歌'
    continue
  }

  const capable = ready.filter((s) => (s.platforms ?? []).includes(p.id))
  const ok = []
  const bad = []

  for (const src of capable) {
    try {
      const r = await window.api.player.getUrl({
        song,
        quality: '320k',
        sourceIds: [src.id]
      })
      const probe = await window.api.player.probe(String(r.url))
      if (probe?.size && song.duration > 0) {
        const est = (probe.size * 8) / (320 * 1000)
        const ratio = est / song.duration
        if (ratio >= 0.75) ok.push(src.name.slice(0, 18))
        else bad.push(`${src.name.slice(0, 14)}(疑似片段 ${Math.round(est)}s)`)
      } else {
        bad.push(`${src.name.slice(0, 14)}(拿不到体积)`)
      }
    } catch (err) {
      const msg = String(err.message).replace(/^Error invoking remote method.*?: Error: /, '')
      const short = /fetch failed/.test(msg)
        ? '网络不通'
        : /30020/.test(msg)
          ? '六音错误码30020'
          : /无法识别的地址格式/.test(msg)
            ? '返回垃圾地址'
            : msg.slice(0, 24)
      bad.push(`${src.name.slice(0, 14)}(${short})`)
    }
  }

  result[p.id] = {
    基准歌: `${song.name} - ${song.singer}`,
    可测音源: capable.length,
    能出完整音频: ok.length,
    清单_可用: ok,
    清单_不可用: bad
  }

  /* 自动择优走一次，看默认选到谁 */
  try {
    const auto = await window.api.player.getUrl({ song, quality: '320k' })
    result[p.id].自动择优 = `${auto.sourceName}（${auto.quality}）`
  } catch (e) {
    result[p.id].自动择优 = '失败: ' + String(e.message).slice(0, 40)
  }
}

return JSON.stringify(result, null, 1)
