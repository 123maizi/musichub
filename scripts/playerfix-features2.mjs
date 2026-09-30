/**
 * 探针（player-fix）第二版：把上一版结论不成立的两项补齐，并加测「播完自动续」。
 *   1. 用 3 首歌的播放队列测 下一首 / 上一首
 *   2. 单曲循环播到结尾：seek(0) 重新开始且仍在播（ended 分支回归）
 *   3. 挑一首**真的有歌词**的英文歌，跑译文编辑器往返 + 翻译入口
 *   4. 正在播放页的进度条/歌词 DOM
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')

const out = {}

const res = await window.api.search.search({ keyword: '晴天', limit: 10 })
const pool = []
for (const p of res.platforms) for (const s of p.songs) if (s.duration >= 120 && s.duration <= 400) pool.push(s)
const queue = []
for (const s of pool) {
  if (queue.length >= 3) break
  if (queue.some((x) => x.id === s.id)) continue
  try {
    await window.api.player.getUrl({ song: s, quality: '320k' })
    queue.push(s)
  } catch {
    /* 跳过 */
  }
}
if (queue.length < 3) return JSON.stringify({ 错误: '可取流的歌不足 3 首' })

/* ---------- 1) 队列 + 歌词 ---------- */
await player.play(queue[0], queue)
for (let i = 0; i < 60; i += 1) {
  await sleep(500)
  if (player.lyricLines.length > 0 && player.playing) break
}
out.队列 = queue.map((s) => `${s.name}/${s.id}`)
out.播放第一首 = { 曲id: player.current?.id, 歌词行数: player.lyricLines.length, playing: player.playing, 错误: player.error }

/* ---------- 2) 下一首 / 上一首 ---------- */
const firstId = player.current?.id
await player.playNext()
for (let i = 0; i < 40; i += 1) {
  await sleep(500)
  if (player.current?.id === queue[1].id && player.playing) break
}
out.下一首 = {
  曲id: player.current?.id,
  期望: queue[1].id,
  换歌了: player.current?.id === queue[1].id,
  playing: player.playing,
  歌词行数: player.lyricLines.length,
  错误: player.error
}
await player.playPrev()
for (let i = 0; i < 40; i += 1) {
  await sleep(500)
  if (player.current?.id === firstId && player.playing) break
}
out.上一首 = { 曲id: player.current?.id, 期望: firstId, 回到第一首: player.current?.id === firstId, playing: player.playing, 错误: player.error }

/* ---------- 3) 单曲循环播到结尾 ---------- */
player.mode = 'single'
player.seek(player.duration - 3)
out.单曲循环_拖到结尾 = { 秒: +player.currentTime.toFixed(2), 时长: +player.duration.toFixed(1), 模式: player.mode }
let restarted = null
for (let i = 0; i < 40; i += 1) {
  await sleep(500)
  if (player.currentTime < 6 && player.playing) {
    restarted = { 秒: +player.currentTime.toFixed(2), playing: player.playing, 曲id: player.current?.id }
    break
  }
}
out.单曲循环_自动重播 = restarted ?? { 失败: '20 秒内没有回到开头继续播', 秒: +player.currentTime.toFixed(2), playing: player.playing, 错误: player.error }
player.mode = 'order'

/* ---------- 4) 正在播放页 DOM ---------- */
location.hash = '#/now-playing'
await sleep(2000)
out.正在播放页 = {
  hash: location.hash,
  歌词行数: document.querySelectorAll('.lyric-line').length,
  进度条宽度: document.querySelector('.seek-fill')?.style?.width ?? null,
  总时长文本: document.querySelectorAll('.progress-row .time')[1]?.innerText?.trim() ?? null,
  当前时间文本: document.querySelectorAll('.progress-row .time')[0]?.innerText?.trim() ?? null,
  翻译按钮: document.querySelector('.translate-btn')?.innerText?.trim() ?? null
}

/* ---------- 5) 英文歌：歌词 + 译文编辑器 + 翻译 ---------- */
const en = await window.api.search.search({ keyword: 'Imagine John Lennon', limit: 10 })
const enSongs = en.platforms.flatMap((p) => p.songs).filter((s) => /imagine/i.test(s.name))
let enPicked = null
for (const s of enSongs.slice(0, 6)) {
  await player.play(s)
  for (let i = 0; i < 30; i += 1) {
    await sleep(500)
    if (player.lyricLines.length > 0) break
  }
  if (player.lyricLines.length > 0) {
    enPicked = s
    break
  }
}
if (!enPicked) {
  out.英文歌 = { 候选: enSongs.length, 结论: '试过的候选都没有歌词，译文链路无法在本轮验证' }
} else {
  out.英文歌 = { 曲: enPicked.name, 平台: enPicked.platform, 歌词行数: player.lyricLines.length, 样例: player.lyricLines.slice(0, 2).map((l) => l.text) }

  player.openEditor()
  out.编辑器 = { 打开: player.editing, 行数: player.editLines.length }
  if (player.editLines.length > 0) {
    player.editLines[0].trans = 'CDP 测试译文'
    const saved = await player.saveEditor()
    out.保存译文 = {
      成功: saved,
      translated: player.translated,
      savedEdited: player.savedEdited,
      首行译文: player.lyricLines.find((l) => !!l.trans)?.trans ?? null,
      编辑器已关闭: !player.editing
    }
    await player.clearTranslation()
    out.清除译文 = { translated: player.translated, savedEdited: player.savedEdited }
  }

  const t0 = Date.now()
  const ok = await player.translateCurrentLyric()
  out.翻译 = {
    返回: ok,
    耗时ms: Date.now() - t0,
    translated: player.translated,
    译文行数: player.lyricLines.filter((l) => !!l.trans).length,
    提示: player.translateError,
    来源: player.savedProvider,
    样例: player.lyricLines.filter((l) => !!l.trans).slice(0, 2).map((l) => l.trans)
  }
}

out.收尾 = { 曲: player.current?.name, playing: player.playing, 秒: +player.currentTime.toFixed(2), 错误: player.error }
return JSON.stringify(out, null, 1)
