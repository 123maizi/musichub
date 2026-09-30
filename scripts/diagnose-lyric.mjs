/**
 * 歌词链路诊断：播一首歌，看歌词到底有没有取到、卡在哪一步。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

// 先在搜索页播一首
window.location.hash = '#/search'
await sleep(2500)
const input = document.querySelector('.search-box input')
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(200)
input.value = '周杰伦 晴天'
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(800)
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))

let rows = []
for (let i = 0; i < 25; i += 1) {
  await sleep(1000)
  rows = [...document.querySelectorAll('.results .row')]
  if (rows.length) break
}
out['搜索结果'] = rows.length
rows[0]?.querySelector('.col-actions button[title="播放"]')?.click()
await sleep(7000)

const song = window.__pinia?.player?.current ?? null
out['当前播放'] = song ? { 曲名: song.name, 歌手: song.singer, 平台: song.platform, 时长: song.duration } : '拿不到'

// 直接调歌词接口，看返回什么
if (song) {
  try {
    const lyric = await window.api.player.getLyric(song)
    out['歌词接口返回'] = lyric
      ? {
          有lyric: Boolean(lyric.lyric),
          有tlyric: Boolean(lyric.tlyric),
          lyric长度: (lyric.lyric ?? '').length,
          前两行: (lyric.lyric ?? '').split('\n').slice(0, 2)
        }
      : null
  } catch (e) {
    out['歌词接口返回'] = '抛错: ' + String(e.message).slice(0, 150)
  }
}

// 到播放页看界面状态
window.location.hash = '#/nowplaying'
await sleep(5000)
out['播放页状态'] = await (async () => {
  const lines = document.querySelectorAll('.lyric-line')
  const empty = document.querySelector('.lyric-empty')
  const err = document.querySelector('.error-strip')
  return {
    lyric行数: lines.length,
    有内容行数: [...lines].filter((l) => (l.innerText || '').trim().replace('·', '').length > 0).length,
    空态提示: empty ? empty.innerText.replace(/\s+/g, ' ').trim().slice(0, 80) : null,
    有翻译按钮: [...document.querySelectorAll('button')].some((b) => /翻译/.test(b.innerText)),
    错误条: err ? err.innerText.replace(/\s+/g, ' ').slice(0, 100) : null
  }
})()

return JSON.stringify(out, null, 1)
