/**
 * 官方翻译覆盖率诊断。
 *
 * 起因：用户截图显示选了「官方翻译 · 网易云」后，十几行歌词里只有**一行**有译文。
 * 这有两种可能，修法完全不同：
 *   A. 平台给的 tlyric 本身就只翻了那一行 → 不是我们的 bug，但需要别的兜底
 *   B. tlyric 里译文行数够，但**时间戳对不上**被 mergeTranslation 的 0.5 秒容差丢掉
 *      （主歌词与译文可能来自不同平台，两家 LRC 的时间戳常有系统性偏移）
 *
 * 所以这里把三件事都量出来：
 *   1. 主歌词来自哪个源、多少行
 *   2. 每个平台的译文多少行
 *   3. 译文行与主歌词行的「最近邻时间差」分布（中位数即系统性偏移）
 *      —— 中位数远大于 0 而最大匹配数很少，就是 B（我们的对齐问题）；
 *         译文行数本来就少，就是 A（源的问题）。
 *
 * 用法: node scripts/cdp-run.mjs <port> scripts/probe-translation-coverage.mjs
 * 探针里不能出现反引号 / ${} / \n（会被外层模板串吃掉）。
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 与 format.ts 的 parseLrc 同构（探针里独立实现一遍，避免依赖打包产物） */
const PARSE = [
  'function parseLrc(lrc) {',
  '  if (!lrc) return [];',
  '  var out = [];',
  '  var re = /\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]/g;',
  '  lrc.split(/\\r?\\n/).forEach(function (raw) {',
  '    var text = raw.replace(re, "").trim();',
  '    var times = [];',
  '    var m;',
  '    re.lastIndex = 0;',
  '    while ((m = re.exec(raw)) !== null) {',
  '      var frac = m[3] === undefined ? 0 : (m[3].length === 3 ? Number(m[3]) / 1000 : Number(m[3]) / 100);',
  '      times.push(Number(m[1]) * 60 + Number(m[2]) + frac);',
  '    }',
  '    times.forEach(function (t) { out.push({ t: t, text: text }); });',
  '  });',
  '  out.sort(function (a, b) { return a.t - b.t });',
  '  return out;',
  '}'
].join('\n')

const QUERY = process.argv[2] || 'Ex-Factor Lauryn Hill'
/** 歌名过滤：搜索结果按平台分组、且经常把翻唱排前面，这里挑出确实是这首的那条 */
const FILTER = process.argv[3] || ''
/** 平台过滤：译文选项要靠「歌名+歌手」去各平台搜，平台对不上就找不到 */
const PLAT = process.argv[4] || ''

const page = await (async () => {
  const list = await (await fetch('http://127.0.0.1:' + (process.env.PERF_CDP_PORT || 9233) + '/json/list')).json()
  return list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
})()

const { default: WebSocket } = await import('ws').catch(() => ({ default: globalThis.WebSocket }))
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
  if (out.exceptionDetails) throw new Error((out.exceptionDetails.exception?.description ?? out.exceptionDetails.text ?? '').slice(0, 900))
  return out.result?.value
}

const report = await ev(`(async () => {
  ${PARSE}
  var api = window.api;
  if (!api || !api.search) return JSON.stringify({ ok: false, why: '没有 window.api.search' });

  var res = await api.search.search({ keyword: ${JSON.stringify(QUERY)}, page: 1, limit: 6 }).catch(function (e) { return { error: String(e) } });
  var songs = [];
  (((res || {}).platforms) || []).forEach(function (g) { (g.songs || []).forEach(function (s) { songs.push(s) }) });
  var FILTER = ${JSON.stringify(FILTER)};
  var PLAT = ${JSON.stringify(PLAT)};
  if (PLAT) songs = songs.filter(function (s) { return s.platform === PLAT });
  if (FILTER) {
    var hit = songs.filter(function (s) { return String(s.name).indexOf(FILTER) >= 0 });
    if (hit.length) songs = hit;
  }
  if (!songs.length) return JSON.stringify({ ok: false, why: '搜索无结果', raw: JSON.stringify(res).slice(0, 400) });

  var out = [];
  for (var i = 0; i < Math.min(songs.length, 4); i += 1) {
    var song = songs[i];
    var lyric = await api.player.getLyric(song).catch(function () { return null });
    var options = await api.player.getLyricTranslations(song).catch(function () { return [] });
    var main = lyric ? parseLrc(lyric.lyric) : [];
    var mainText = main.filter(function (l) { return l.text });
    var detail = [];
    (options || []).forEach(function (opt) {
      var tr = parseLrc(opt.tlyric).filter(function (l) { return l.text });

      /* ---- 现状（固定 0.5 秒最近邻）能配上几行 ---- */
      var oldMatch = 0;
      mainText.forEach(function (m) {
        var best = Infinity;
        tr.forEach(function (t) { var g = Math.abs(t.t - m.t); if (g < best) best = g });
        if (best <= 0.5) oldMatch += 1;
      });

      /* ---- 系统性偏移：每条译文找 4 秒内最近的原文，取「有符号时间差」的中位数 ---- */
      var deltas = [];
      tr.forEach(function (t) {
        var best = Infinity, bestT = null;
        mainText.forEach(function (m) { var g = Math.abs(m.t - t.t); if (g < best) { best = g; bestT = m.t } });
        if (best <= 4 && bestT !== null) deltas.push(t.t - bestT);
      });
      deltas.sort(function (a, b) { return a - b });
      var offset = deltas.length >= 4 ? deltas[Math.floor(deltas.length / 2)] : 0;
      if (Math.abs(offset) > 6) offset = 0;
      offset = Math.round(offset * 1000) / 1000;

      /* ---- 候选修法：去偏移 + 两指针单调对齐（容差 1 秒）---- */
      var TOL = 1.0;
      var j = 0, newMatch = 0, samples = [];
      for (var mi = 0; mi < mainText.length; mi += 1) {
        var m = mainText[mi];
        while (j < tr.length && tr[j].t - offset < m.t - TOL) j += 1;
        if (j < tr.length && Math.abs(tr[j].t - offset - m.t) <= TOL) {
          newMatch += 1;
          if (samples.length < 5) samples.push(m.text.slice(0, 30) + '  →  ' + tr[j].text.slice(0, 30));
          j += 1;
        }
      }

      detail.push({
        平台: opt.platform,
        译文行数: tr.length,
        译文样例: tr.slice(0, 3).map(function (l) { return Math.round(l.t * 100) / 100 + ' ' + l.text.slice(0, 24) }),
        估计偏移秒: offset,
        偏移样本数: deltas.length,
        现状_能配上几行: oldMatch,
        候选修法_能配上几行: newMatch,
        对齐样例: samples,
        __raw: { mainLrc: lyric ? lyric.lyric : null, tlyric: opt.tlyric }
      });
    });
    out.push({
      歌名: song.name + ' - ' + song.singer,
      平台: song.platform,
      主歌词源: lyric ? lyric.sourceId : null,
      主歌词有字行数: mainText.length,
      主歌词样例: mainText.slice(0, 3).map(function (l) { return Math.round(l.t * 100) / 100 + ' ' + l.text.slice(0, 24) }),
      译文选项: detail
    });
  }
  return JSON.stringify({ ok: true, 查询: ${JSON.stringify(QUERY)}, 结果: out }, null, 1);
})()`)

console.log(report)

/**
 * 把真实报文另存一份，供单元测试脚本（scripts/verify-translation-align.ts）当输入用。
 * 手搓样例测不出这类问题 —— 偏移、行数不等、头部 credits 行都是真实数据里的形态。
 */
if (process.env.DUMP) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(process.env.DUMP, report, 'utf8')
  console.log('已写出真实报文: ' + process.env.DUMP)
}
ws.close()
process.exit(0)
