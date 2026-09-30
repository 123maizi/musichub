/**
 * 探针（player-fix）第三版：补最后两项
 *   1. 正在播放页到底渲染了什么（上一版取到的 DOM 全是 null，要查清是不是渲染出错）
 *   2. 找一首「平台没自带译文」的歌，真正走一次翻译请求（AI / 内置公共接口）
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')

const out = {}

/* ---------- 1) 正在播放页 DOM ---------- */
location.hash = '#/now-playing'
await sleep(2500)
out.正在播放页 = {
  hash: location.hash,
  app文本前120字: (document.querySelector('#app')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 120),
  view数: document.querySelectorAll('.view').length,
  stage数: document.querySelectorAll('.stage').length,
  lyricLine数: document.querySelectorAll('.lyric-line').length,
  seekFill: document.querySelector('.seek-fill')?.style?.width ?? null,
  progressFill: document.querySelector('.progress-fill')?.style?.width ?? null,
  h1: document.querySelector('h1')?.innerText?.trim() ?? null,
  控制按钮数: document.querySelectorAll('.ctrl').length,
  当前曲: player.current?.name ?? null,
  歌词行数store: player.lyricLines.length
}

/* ---------- 2) 真翻译：找平台没带译文的歌 ---------- */
const queries = ['Yesterday Beatles', 'Hey Jude Beatles', 'Let It Be Beatles']
let target = null
for (const q of queries) {
  const r = await window.api.search.search({ keyword: q, limit: 10 })
  const songs = r.platforms.flatMap((p) => p.songs)
  for (const s of songs.slice(0, 8)) {
    try {
      await player.play(s)
    } catch {
      continue
    }
    for (let i = 0; i < 24; i += 1) {
      await sleep(500)
      if (player.lyricLines.length > 0) break
    }
    const withTrans = player.lyricLines.filter((l) => !!l.trans).length
    if (player.lyricLines.length > 0 && withTrans === 0) {
      target = { 查询: q, 曲: s.name, 平台: s.platform, 歌词行数: player.lyricLines.length, 平台译文行数: withTrans }
      break
    }
  }
  if (target) break
}

if (!target) {
  out.真翻译 = { 结论: '没找到「有歌词但平台没带译文」的歌，真翻译请求未跑' }
} else {
  out.真翻译_选曲 = target
  const t0 = Date.now()
  const ok = await player.translateCurrentLyric()
  out.真翻译 = {
    返回: ok,
    耗时ms: Date.now() - t0,
    translated: player.translated,
    译文行数: player.lyricLines.filter((l) => !!l.trans).length,
    错误提示: player.translateError,
    来源: player.savedProvider,
    模型名: player.savedProviderName,
    样例: player.lyricLines.filter((l) => !!l.trans).slice(0, 3).map((l) => l.trans)
  }
}

out.收尾 = { 曲: player.current?.name, playing: player.playing, 错误: player.error }
return JSON.stringify(out, null, 1)
