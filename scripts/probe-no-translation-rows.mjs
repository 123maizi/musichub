/**
 * 为端到端场景挑选「有歌词、但平台没有现成译文」的稳定条目。
 * 只走 IPC（不播放），所以很快。
 *
 * 用法: node scripts/probe-no-translation-rows.mjs <端口> "查询" [平台]
 */
const PORT = Number(process.argv[2] || 9233)
const QUERY = process.argv[3] || 'Shape of You'
const PLAT = process.argv[4] || ''

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

const res = await ev(`(async () => {
  var api = window.api;
  var r = await api.search.search({ keyword: ${JSON.stringify(QUERY)}, page: 1, limit: 8 }).catch(function () { return {} });
  var songs = [];
  (((r || {}).platforms) || []).forEach(function (g) { (g.songs || []).forEach(function (s) { songs.push(s) }) });
  var out = [];
  for (var i = 0; i < songs.length && out.length < 12; i += 1) {
    var s = songs[i];
    if (${JSON.stringify(PLAT)} && s.platform !== ${JSON.stringify(PLAT)}) continue;
    var l = await api.player.getLyric(s).catch(function () { return null });
    var text = l ? (l.lyric || l.lxlyric || '') : '';
    var lines = text.split(/\\r?\\n/).filter(function (x) { return x.replace(/\\[[^\\]]*\\]/g, '').trim() }).length;
    if (lines < 8) continue;
    var opts = await api.player.getLyricTranslations(s).catch(function () { return [] });
    if ((opts || []).length > 0) continue;
    out.push({ 歌: String(s.name) + ' - ' + String(s.singer), 平台: s.platform, 歌词行数: lines, 自带译文: l && l.tlyric ? '有' : '无' });
  }
  return JSON.stringify(out, null, 1);
})()`)
console.log(res)
ws.close()
process.exit(0)
