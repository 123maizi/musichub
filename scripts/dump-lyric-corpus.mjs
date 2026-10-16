/**
 * 把真实歌词/译文报文抓成语料，供「新旧对齐算法 A/B」离线比对。
 *
 * 起因：用户报「更新后很多本来有一半中文歌词的歌，现在完全没有中文翻译了」。
 * 这类回归不能靠读代码猜 —— 必须拿真实报文把新旧两版算法跑一遍，
 * 看新算法在哪些曲目上把译文行数打到了 0。
 *
 * 用法: node scripts/dump-lyric-corpus.mjs <端口> [输出文件]
 */
const PORT = Number(process.argv[2] || 9233)
const OUT = process.argv[3] || '.tmp/lyric-corpus.json'

const QUERIES = [
  'Dandelions Ruth B',
  'Shape of You Ed Sheeran',
  'Perfect Ed Sheeran',
  'Blinding Lights The Weeknd',
  'Lemon 米津玄師',
  'Ex-Factor Lauryn Hill',
  'Nothing On You Ed Sheeran',
  'Stargirl Interlude The Weeknd',
  'Stay The Kid LAROI',
  'Peaches Justin Bieber',
  'Yellow Coldplay',
  'Faded Alan Walker'
]

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
}
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })
await send('Runtime.enable')
const ev = async (expr) => {
  const out = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true })
  if (out.exceptionDetails) throw new Error((out.exceptionDetails.exception?.description ?? out.exceptionDetails.text ?? '').slice(0, 700))
  return out.result?.value
}

const corpus = []
for (const query of QUERIES) {
  const raw = await ev(`(async () => {
    var api = window.api;
    var r = await api.search.search({ keyword: ${JSON.stringify(query)}, page: 1, limit: 6 }).catch(function () { return {} });
    var songs = [];
    (((r || {}).platforms) || []).forEach(function (g) { (g.songs || []).forEach(function (s) { songs.push(s) }) });
    var out = [];
    for (var i = 0; i < songs.length && out.length < 2; i += 1) {
      var s = songs[i];
      var l = await api.player.getLyric(s).catch(function () { return null });
      var text = l ? (l.lyric || l.lxlyric || '') : '';
      if (!text || text.length < 120) continue;
      var opts = await api.player.getLyricTranslations(s).catch(function () { return [] });
      out.push({
        song: s.name + ' - ' + s.singer,
        platform: s.platform,
        sourceId: l.sourceId,
        base: text,
        baseTlyric: l.tlyric || '',
        options: (opts || []).map(function (o) { return { platform: o.platform, tlyric: o.tlyric } })
      });
    }
    return JSON.stringify(out);
  })()`)
  const items = JSON.parse(raw)
  for (const it of items) corpus.push(it)
  console.log(query + ' → ' + items.length + ' 条（' + items.map((x) => x.platform + ':' + x.options.length + '选项').join(' ') + '）')
}

const { writeFileSync } = await import('node:fs')
writeFileSync(OUT, JSON.stringify(corpus, null, 1), 'utf8')
console.log('语料条数 ' + corpus.length + ' → ' + OUT)
ws.close()
process.exit(0)
