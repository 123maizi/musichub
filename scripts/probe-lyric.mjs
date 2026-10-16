/**
 * 五平台歌词/译文覆盖率普查（只读接口，不改代码、不动播放链路）。
 *
 * 目的：在决定「多平台取译文 / 并集合并 / AI 补齐」之前，先把事实量出来：
 *   1. 每个提供方返回的**原文行数**
 *   2. 每个提供方**自带的译文**覆盖了多少行（按主歌词的时间轴对齐后统计）
 *   3. 所有提供方**并集**覆盖多少行
 *   4. 哪些行是**所有提供方都没翻**的
 *   5. 各家的**分行方式是否一致**（行数 + 时间戳偏差）—— 这是并集合并真正的难点
 *
 * 提供方 = 内置官方译文（QQ音乐 / 网易云，走 play:lyricTranslations）
 *        + 各音源脚本自己的歌词接口（走 play:getLyric，按平台筛，带 lyric 能力的源）
 *
 * 用法: node scripts/probe-lyric.mjs <端口> [每平台最多取几个音源]
 */
const PORT = Number(process.argv[2] || 9233)
const PER_PLATFORM = Number(process.argv[3] || 2)

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
  if (out.exceptionDetails) {
    throw new Error((out.exceptionDetails.exception?.description ?? out.exceptionDetails.text ?? '').slice(0, 900))
  }
  return out.result?.value
}

const raw = await ev(`(async () => {
  var api = window.api;

  /* ---------- 代表性选曲：英文 / 日文 / 韩文 + 副歌重复多、有念白 ---------- */
  var SONGS = [
    { q: 'Shape of You Ed Sheeran', want: 'Shape of You', lang: '英文' },
    { q: 'Blinding Lights The Weeknd', want: 'Blinding Lights', lang: '英文(副歌重复多)' },
    { q: 'Lemon 米津玄師', want: 'Lemon', lang: '日文' },
    { q: '残酷な天使のテーゼ 高橋洋子', want: '残酷', lang: '日文' },
    { q: 'Dynamite BTS', want: 'Dynamite', lang: '韩文' },
    { q: 'How You Like That BLACKPINK', want: 'How You Like That', lang: '韩文' }
  ];
  var PLATFORMS = ['kg', 'kw', 'mg', 'tx', 'wy'];

  function parseLrc(lrc) {
    if (!lrc) return [];
    var out = [], re = /\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]/g;
    lrc.split(/\\r?\\n/).forEach(function (rawLine) {
      var text = rawLine.replace(re, '').trim();
      var times = [], m; re.lastIndex = 0;
      while ((m = re.exec(rawLine)) !== null) {
        var frac = m[3] === undefined ? 0 : (m[3].length === 3 ? Number(m[3]) / 1000 : Number(m[3]) / 100);
        times.push(Number(m[1]) * 60 + Number(m[2]) + frac);
      }
      times.forEach(function (t) { if (text) out.push({ t: t, text: text }); });
    });
    out.sort(function (a, b) { return a.t - b.t });
    return out;
  }
  function medOffset(base, trans) {
    var deltas = [];
    trans.forEach(function (t) {
      var best = Infinity, bestT = 0;
      base.forEach(function (l) { var g = Math.abs(l.t - t.t); if (g < best) { best = g; bestT = l.t } });
      if (best <= 6) deltas.push(t.t - bestT);
    });
    if (deltas.length < 4) return { offset: 0, samples: deltas.length };
    deltas.sort(function (a, b) { return a - b });
    var med = deltas[Math.floor(deltas.length / 2)];
    return { offset: Math.abs(med) > 5 ? 0 : med, samples: deltas.length };
  }
  /** 每条译文行对齐到基准原文行（容差 1 秒），返回被覆盖的基准行下标集合 */
  function coveredIndexes(base, tlyric) {
    var trans = parseLrc(tlyric);
    if (!trans.length) return { idx: [], offset: 0, samples: 0 };
    var o = medOffset(base, trans);
    var set = [];
    base.forEach(function (l, i) {
      for (var k = 0; k < trans.length; k += 1) {
        if (Math.abs(trans[k].t - o.offset - l.t) <= 1) { set.push(i); return }
      }
    });
    return { idx: set, offset: Math.round(o.offset * 1000) / 1000, samples: o.samples };
  }

  var sources = await api.source.list().catch(function () { return [] });
  var byPlatform = {};
  PLATFORMS.forEach(function (p) {
    byPlatform[p] = (sources || [])
      .filter(function (s) {
        return s.enabled !== false && s.status !== 'error' &&
          (s.platforms || []).indexOf(p) >= 0 &&
          (s.capabilities || []).indexOf('lyric') >= 0;
      })
      .slice(0, ${Number.isFinite(PER_PLATFORM) ? PER_PLATFORM : 2});
  });

  var report = [];
  for (var si = 0; si < SONGS.length; si += 1) {
    var spec = SONGS[si];
    var res = await api.search.search({ keyword: spec.q, page: 1, limit: 6 }).catch(function () { return {} });
    var all = [];
    (((res || {}).platforms) || []).forEach(function (g) { (g.songs || []).forEach(function (s) { all.push(s) }) });
    var clean = function (s) {
      return String(s.name).indexOf(spec.want) >= 0 && !/伴奏|翻奏|dj|混音|remix|slowed|karaoke|纯音乐/i.test(String(s.name));
    };
    var pickByPlat = {};
    PLATFORMS.forEach(function (p) {
      pickByPlat[p] = all.filter(function (s) { return s.platform === p && clean(s) })[0] || null;
    });
    var anySong = pickByPlat.wy || pickByPlat.tx || all.filter(clean)[0] || all[0];
    if (!anySong) { report.push({ 歌: spec.q, 结果: '搜不到' }); continue; }

    // 基准原文：内置歌词服务（用户实际看到的那份）
    var baseLyric = await api.player.getLyric(anySong).catch(function () { return null });
    var baseText = baseLyric ? (baseLyric.lyric || baseLyric.lxlyric || '') : '';
    var base = parseLrc(baseText);
    if (!base.length) { report.push({ 歌: spec.q, 结果: '基准歌词为空' }); continue; }

    var providers = [];

    // 1) 内置官方译文（QQ / 网易云）
    var opts = await api.player.getLyricTranslations(anySong).catch(function () { return [] });
    (opts || []).forEach(function (o) {
      var c = coveredIndexes(base, o.tlyric);
      providers.push({
        来源: '内置官方译文 · ' + o.platform,
        类型: 'official',
        原文行数: null,
        译文行数: parseLrc(o.tlyric).length,
        覆盖行数: c.idx.length,
        偏移秒: c.offset,
        覆盖下标: c.idx
      });
    });

    // 2) 各音源自己的歌词接口（按平台筛）
    for (var pi = 0; pi < PLATFORMS.length; pi += 1) {
      var p = PLATFORMS[pi];
      var song = pickByPlat[p];
      if (!song) continue;
      var cands = byPlatform[p];
      for (var ci = 0; ci < cands.length; ci += 1) {
        var src = cands[ci];
        var got = await api.player.getLyric(song, [src.id]).catch(function () { return null });
        if (!got) continue;
        var text = got.lyric || got.lxlyric || '';
        var lines = parseLrc(text);
        var trans = got.tlyric ? parseLrc(got.tlyric) : [];
        var cov = got.tlyric ? coveredIndexes(base, got.tlyric) : { idx: [], offset: 0, samples: 0 };
        providers.push({
          来源: '音源 · ' + src.name + ' [' + p + ']',
          类型: 'source',
          平台: p,
          原文行数: lines.length,
          译文行数: trans.length,
          覆盖行数: cov.idx.length,
          偏移秒: cov.offset,
          覆盖下标: cov.idx
        });
      }
    }

    // 并集
    var union = {};
    providers.forEach(function (pv) { (pv.覆盖下标 || []).forEach(function (i) { union[i] = true }) });
    var unionCount = Object.keys(union).length;
    var never = [];
    for (var i = 0; i < base.length; i += 1) if (!union[i]) never.push(base[i].text.slice(0, 26));

    // 分行一致性：各提供方原文行数与基准的差
    var splitDiffs = providers
      .filter(function (pv) { return pv.原文行数 !== null })
      .map(function (pv) { return pv.来源 + '=' + pv.原文行数 + '(基准' + base.length + ')' });

    report.push({
      歌: spec.q + ' [' + spec.lang + ']',
      基准原文行数: base.length,
      基准来源: baseLyric ? baseLyric.sourceId : null,
      提供方数: providers.length,
      并集覆盖行数: unionCount,
      并集覆盖率: Math.round((unionCount / base.length) * 1000) / 10 + '%',
      从未被翻译的行数: never.length,
      从未被翻译样例: never.slice(0, 6),
      分行差异: splitDiffs,
      明细: providers.map(function (pv) {
        return pv.来源 + ' 译文' + pv.译文行数 + '行/覆盖' + pv.覆盖行数 + '行(偏移' + pv.偏移秒 + 's)';
      })
    });
  }

  return JSON.stringify({
    平台音源池: Object.keys(byPlatform).map(function (p) { return p + ':' + byPlatform[p].length + '源' }),
    结果: report
  }, null, 1);
})()`)

console.log(raw)
ws.close()
process.exit(0)
