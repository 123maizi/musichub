/**
 * 补齐链路逐段体检：把「补齐」用到的每一步单独量一遍。
 *
 * 分不清「没触发」和「触发了但没成功」就只能瞎改，所以这里分三段：
 *   1. 主歌词拿到的行数、汉字占比（汉字占比决定「要不要翻」那道闸门）
 *   2. 现成译文覆盖多少行
 *   3. 真拿 18 行缺译文丢进 translateLyric，看返回的 LRC 与时间戳
 *
 * 用法: node scripts/probe-gapfill-path.mjs <端口> "查询" "歌名前缀" [平台]
 */
const PORT = Number(process.argv[2] || 9233)
const QUERY = process.argv[3] || 'Shape of You Ed Sheeran'
const WANT = process.argv[4] || 'Shape of You'
const PLAT = process.argv[5] || 'KG'

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
  function parse(lrc) {
    if (!lrc) return [];
    var out = [], re = /\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]/g;
    lrc.split(/\\r?\\n/).forEach(function (raw) {
      var text = raw.replace(re, '').trim();
      var times = [], m; re.lastIndex = 0;
      while ((m = re.exec(raw)) !== null) {
        var frac = m[3] === undefined ? 0 : (m[3].length === 3 ? Number(m[3]) / 1000 : Number(m[3]) / 100);
        times.push(Number(m[1]) * 60 + Number(m[2]) + frac);
      }
      times.forEach(function (t) { if (text) out.push({ t: t, text: text }); });
    });
    out.sort(function (a, b) { return a.t - b.t });
    return out;
  }

  var r = await api.search.search({ keyword: ${JSON.stringify(QUERY)}, page: 1, limit: 8 }).catch(function () { return {} });
  var songs = [];
  (((r || {}).platforms) || []).forEach(function (g) { (g.songs || []).forEach(function (s) { songs.push(s) }) });
  var song = null;
  for (var i = 0; i < songs.length; i += 1) {
    var s = songs[i];
    if (s.platform !== ${JSON.stringify(PLAT)}) continue;
    if (String(s.name).indexOf(${JSON.stringify(WANT)}) !== 0) continue;
    if (/伴奏|翻奏|dj|混音|remix|slowed/i.test(String(s.name))) continue;
    song = s; break;
  }
  if (!song) return JSON.stringify({ ok: false, why: '没找到候选' });

  var lyric = await api.player.getLyric(song).catch(function () { return null });
  var base = lyric ? (lyric.lyric || lyric.lxlyric || '') : '';
  var lines = parse(base);
  var all = lines.map(function (l) { return l.text }).join('');
  var cjk = (all.match(/[\\u4e00-\\u9fff]/g) || []).length;
  var ratio = all.length ? Math.round((cjk / all.length) * 1000) / 1000 : 0;

  var opts = await api.player.getLyricTranslations(song).catch(function () { return [] });
  var opt = (opts || [])[0];

  // 用与 format.ts 相同的最近邻（容差 1s）算覆盖
  var tlines = opt ? parse(opt.tlyric) : [];
  function covered(offset) {
    var n = 0;
    lines.forEach(function (l) {
      for (var k = 0; k < tlines.length; k += 1) {
        if (Math.abs(tlines[k].t - offset - l.t) <= 1) { n += 1; return }
      }
    });
    return n;
  }
  // 估偏移（有符号最近邻中位数）
  var deltas = [];
  tlines.forEach(function (t) {
    var best = Infinity, bestT = 0;
    lines.forEach(function (l) { var g = Math.abs(l.t - t.t); if (g < best) { best = g; bestT = l.t } });
    if (best <= 6) deltas.push(t.t - bestT);
  });
  deltas.sort(function (a, b) { return a - b });
  var offset = deltas.length >= 4 ? deltas[Math.floor(deltas.length / 2)] : 0;
  var coveredN = covered(offset);

  var missing = [];
  lines.forEach(function (l) {
    var hit = false;
    for (var k = 0; k < tlines.length; k += 1) {
      if (Math.abs(tlines[k].t - offset - l.t) <= 1) { hit = true; break }
    }
    if (!hit) missing.push(l);
  });

  // 真跑一批补齐（最多 18 行，与实现一致）
  var batch = missing.slice(0, 18);
  var gapMs = 0, gapOut = null;
  if (batch.length) {
    var payload = {
      lyric: batch.map(function (l) {
        var min = Math.floor(l.t / 60), sec = Math.floor(l.t % 60);
        var centi = Math.round((l.t - Math.floor(l.t)) * 100);
        return '[' + String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(centi).padStart(2, '0') + ']' + l.text;
      }).join(String.fromCharCode(10)),
      sourceId: 'gap-fill'
    };
    var t0 = Date.now();
    var out = await api.player.translateLyric(payload, undefined, song).catch(function (e) { return { error: String(e) } });
    gapMs = Date.now() - t0;
    gapOut = out ? {
      provider: out.provider,
      error: out.error || null,
      got: out.lyric && out.lyric.tlyric ? out.lyric.tlyric.split(/\\r?\\n/).slice(0, 4) : null,
      lineCount: out.lineCount,
      totalCount: out.totalCount
    } : null;
  }

  return JSON.stringify({
    ok: true,
    歌: song.name + ' - ' + song.singer,
    主歌词源: lyric ? lyric.sourceId : null,
    主歌词有字行数: lines.length,
    汉字占比: ratio,
    needsTranslation: ratio < 0.3 ? '允许（判为非中文）' : '拦住（判为中文）',
    现成译文: opt ? opt.platform : null,
    译文行数: tlines.length,
    估计偏移秒: Math.round(offset * 1000) / 1000,
    已覆盖行数: coveredN,
    缺译文行数: missing.length,
    缺行样例: missing.slice(0, 3).map(function (l) { return l.text.slice(0, 30) }),
    补齐一批: { 行数: batch.length, 耗时ms: gapMs, 返回: gapOut }
  }, null, 1);
})()`)
console.log(res)
ws.close()
process.exit(0)
