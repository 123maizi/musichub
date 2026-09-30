/**
 * 探针（player-fix）：既有功能回归 —— 歌词、拖动进度条（前/后）、切歌、收藏、下载、译文编辑。
 *
 * 下载会临时把保存目录改到 .tmp 下，测完删掉临时任务与文件，再恢复原目录，
 * 全程不碰用户真正的下载目录。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')
const library = pinia._s.get('library')
const downloads = pinia._s.get('downloads')

const out = {}

/* ---------- 1) 播放 + 歌词 ---------- */
const res = await window.api.search.search({ keyword: '晴天', limit: 10 })
const pool = []
for (const p of res.platforms) for (const s of p.songs) if (s.duration >= 150 && s.duration <= 400) pool.push(s)

let song = null
for (const s of pool.slice(0, 6)) {
  try {
    await window.api.player.getUrl({ song: s, quality: '320k' })
    song = s
    break
  } catch {
    /* 跳过 */
  }
}
if (!song) return JSON.stringify({ 错误: '没有可取流的歌' })

await player.play(song)
for (let i = 0; i < 60; i += 1) {
  await sleep(500)
  if (player.lyricLines.length > 0 && (window.__pfAudio?.readyState ?? 0) >= 2) break
}
out.播放 = {
  曲: player.current?.name,
  标注时长: song.duration,
  歌词行数: player.lyricLines.length,
  歌词样例: player.lyricLines.slice(0, 3).map((l) => l.text),
  音源: player.urlInfo?.sourceName,
  playing: player.playing,
  错误: player.error
}

/* ---------- 2) 拖动进度条：往前、往后 ---------- */
const before = +player.currentTime.toFixed(2)
player.seekByPercent(50)
await sleep(1500)
out.拖到50 = { 秒: +player.currentTime.toFixed(2), 进度: +player.progress.toFixed(2), 时长: +player.duration.toFixed(1), playing: player.playing }
/* 界面上的进度条是否真的跟着走（PlayerBar 自绘的 .progress-fill 宽度） */
out.拖到50.界面进度条宽度 = document.querySelector('.progress-fill')?.style?.width ?? null
/* 正在播放页也有一条 */
out.拖到50.正在播放页宽度 = document.querySelector('.seek-fill')?.style?.width ?? null
player.seekByPercent(8)
await sleep(1500)
out.拖回8 = { 秒: +player.currentTime.toFixed(2), 进度: +player.progress.toFixed(2), playing: player.playing, 允许用户主动回退: player.progress < out.拖到50.进度 }
out.拖动前秒 = before
player.seekByPercent(50)
await sleep(1500)
const seeked = +player.currentTime.toFixed(2)
out.拖动落点偏差秒 = +(seeked - player.duration * 0.5).toFixed(2)

/* ---------- 3) 切歌（下一首 / 上一首） ---------- */
const firstId = player.current?.id
player.playNext()
for (let i = 0; i < 40; i += 1) {
  await sleep(500)
  if (player.current?.id !== firstId && player.playing) break
}
out.下一首 = { 曲: player.current?.name, 换歌了: player.current?.id !== firstId, playing: player.playing, 错误: player.error }
player.playPrev()
for (let i = 0; i < 40; i += 1) {
  await sleep(500)
  if (player.current?.id === firstId && player.playing) break
}
out.上一首 = { 曲: player.current?.name, 回到第一首: player.current?.id === firstId, playing: player.playing, 错误: player.error }

/* ---------- 4) 收藏 ---------- */
const fav0 = library.isFavorite(song.id)
await library.toggleFavorite(song)
await sleep(600)
const fav1 = library.isFavorite(song.id)
await library.toggleFavorite(song)
await sleep(600)
const fav2 = library.isFavorite(song.id)
out.收藏 = { 初始: fav0, 收藏后: fav1, 取消后: fav2, 逻辑正确: fav1 !== fav0 && fav2 === fav0 }

/* ---------- 5) 下载（临时目录） ---------- */
const cfgBefore = await window.api.download.getConfig()
const tmpDir = 'F:\\MusicHub\\.tmp\\playerfix-dl'
await downloads.setConfig({ dir: tmpDir })
out.下载目录_临时 = downloads.config?.dir ?? cfgBefore.dir
try {
  await downloads.add([song], { quality: '320k' })
  let task = null
  for (let i = 0; i < 60; i += 1) {
    await sleep(500)
    task = downloads.tasks.find((t) => t.song.id === song.id) ?? null
    if (task && (task.progress > 0 || task.status === 'done' || task.status === 'error')) break
  }
  out.下载 = task
    ? {
        状态: task.status,
        进度: task.progress,
        已下载: task.received,
        总大小: task.total,
        文件名: task.fileName,
        保存路径: task.savePath,
        在临时目录里: String(task.savePath).startsWith(tmpDir),
        错误: task.error ?? null
      }
    : { 错误: '没有生成下载任务' }
  if (task) await downloads.remove([task.id], true)
  out.下载清理 = { 剩余任务: downloads.tasks.length }
} finally {
  await downloads.setConfig({ dir: cfgBefore.dir })
  out.下载目录_已恢复 = downloads.config?.dir
  out.下载目录_与原来一致 = downloads.config?.dir === cfgBefore.dir
}

/* ---------- 6) 译文：编辑器往返 + 翻译入口 ---------- */
const en = await window.api.search.search({ keyword: 'Imagine John Lennon', limit: 10 })
const enSong = en.platforms.flatMap((p) => p.songs).find((s) => /imagine/i.test(s.name)) ?? null
if (enSong) {
  await player.play(enSong)
  for (let i = 0; i < 60; i += 1) {
    await sleep(500)
    if (player.lyricLines.length > 0) break
  }
  out.英文歌 = { 曲: player.current?.name, 歌词行数: player.lyricLines.length }

  player.openEditor()
  out.编辑器 = { 打开: player.editing, 行数: player.editLines.length }
  if (player.editLines.length > 0) {
    player.editLines[0].trans = 'CDP 测试译文'
    const saved = await player.saveEditor()
    out.保存译文 = {
      成功: saved,
      translated: player.translated,
      savedEdited: player.savedEdited,
      首行译文: player.lyricLines[0]?.trans ?? null,
      编辑器已关闭: !player.editing
    }
    await player.clearTranslation()
    out.清除译文 = { translated: player.translated, savedEdited: player.savedEdited, 首行译文: player.lyricLines[0]?.trans ?? null }
  }

  const t0 = Date.now()
  const translated = await player.translateCurrentLyric()
  out.翻译 = {
    返回: translated,
    耗时ms: Date.now() - t0,
    translated: player.translated,
    译文行数: player.lyricLines.filter((l) => !!l.trans).length,
    提示: player.translateError,
    来源: player.savedProvider
  }
} else {
  out.英文歌 = { 错误: '没搜到 Imagine' }
}

out.收尾 = { 当前曲: player.current?.name, playing: player.playing, 错误: player.error }
return JSON.stringify(out, null, 1)
