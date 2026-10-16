/**
 * 「现成译文」可得性普查（按用户真实处境取样）。
 *
 * 上一版探针直接取搜索结果第一条，结果 8 条里 7 条是「KTV 伴奏 / 翻奏 / DJ 版」
 * 这种**压根没有歌词**的条目 —— 没有歌词自然没有译文，测出来的 0% 不代表用户体验。
 *
 * 这一版改成：在一组候选里挑**确实有歌词**的那条（也就是用户真正会播的那种），
 * 再量它的现成译文拿不拿得到。同时额外汇总量一次「去掉括号后的歌名」的结果，
 * 用来判断宽松匹配这一层到底救回来多少。
 *
 * 用法: node scripts/probe-translation-availability.mjs [端口] [查询1,查询2,...]
 */
const PORT = Number(process.argv[2] || 9233)
const QUERIES = (
  process.argv[3] ||
  [
    'Shape of You Ed Sheeran',
    'Blinding Lights The Weeknd',
    'Dandelions Ruth B',
    'Perfect Ed Sheeran',
    'Lemon 米津玄師',
    'Ex-Factor Lauryn Hill',
    '晴天 周杰伦',
    '起风了 买辣椒也用券'
  ].join(',')
).split(',')

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
  if (out.exceptionDetails) throw new Error((out.exceptionDetails.exception?.description ?? out.exceptionDetails.text ?? '').slice(0, 800))
  return out.result?.value
}

const strip = (name) =>
  name
    .replace(/[（(【[｛{〔〈<「『《][^）)】\]｝}〕〉>」』》]*[）)】\]｝}〕〉>」』》]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || name

for (const query of QUERIES) {
  const raw = await ev(`(async () => {
    var api = window.api;
    var res = await api.search.search({ keyword: ${JSON.stringify(query)}, page: 1, limit: 8 }).catch(function () { return {} });
    var songs = [];
    (((res || {}).platforms) || []).forEach(function (g) { (g.songs || []).forEach(function (s) { songs.push(s) }) });
    if (!songs.length) return JSON.stringify({ ok: false, why: '搜索无结果' });

    // 找第一条**确实有歌词**的（用户真正会播的那种）
    var picked = null, pickedLyric = null;
    for (var i = 0; i < songs.length; i += 1) {
      var l = await api.player.getLyric(songs[i]).catch(function () { return null });
      if (l && (l.lyric || l.lxlyric) && (l.lyric || l.lxlyric).length > 80) { picked = songs[i]; pickedLyric = l; break; }
    }
    if (!picked) return JSON.stringify({ ok: false, why: '前 8 条候选都没有歌词' });

    var t0 = performance.now();
    var options = await api.player.getLyricTranslations(picked).catch(function () { return [] });
    var ms = Math.round(performance.now() - t0);

    var name = String(picked.name);
    var stripped = name.replace(/[（(【[｛{〔〈<「『《][^）)】\\]｝}〕〉>」』》]*[）)】\\]｝}〕〉>」』》]/g, ' ').replace(/\\s+/g, ' ').trim() || name;
    var looseOptions = null;
    if ((!options || !options.length) && stripped !== name) {
      looseOptions = await api.player.getLyricTranslations(Object.assign({}, picked, { name: stripped })).catch(function () { return [] });
    }

    var lyricText = pickedLyric.lyric || pickedLyric.lxlyric || '';
    return JSON.stringify({
      ok: true,
      歌: name + ' - ' + picked.singer,
      平台: picked.platform,
      主歌词源: pickedLyric.sourceId,
      主歌词行数: lyricText.split(/\\r?\\n/).filter(function (x) { return x.replace(/\\[[^\\]]*\\]/g, '').trim() }).length,
      歌词自带译文: pickedLyric.tlyric && pickedLyric.tlyric.trim() ? '有' : '无',
      耗时ms: ms,
      现成译文: (options || []).map(function (o) { return o.platform + '(' + String(o.tlyric).split(/\\r?\\n/).length + '行)' }),
      去括号后重试: looseOptions === null ? '(未触发)' : (looseOptions || []).map(function (o) { return o.platform + '(' + String(o.tlyric).split(/\\r?\\n/).length + '行)' })
    });
  })()`)
  console.log(raw)
}

ws.close()
process.exit(0)
