/** 直接验证歌词接口：拿搜索结果里的歌去问主进程要歌词 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

out['可用API'] = Object.keys(window.api.player ?? {})

// 搜索拿一首歌
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

for (let i = 0; i < 25; i += 1) {
  await sleep(1000)
  if (document.querySelectorAll('.results .row').length) break
}

// 通过搜索接口直接拿 song 对象（有 id/platform/songmid）
const res = await window.api.search.search({ keyword: '周杰伦 晴天', limit: 10 })
const song = res.platforms.flatMap((p) => p.songs)[0]
out['测试歌曲'] = song ? { 曲名: song.name, 歌手: song.singer, 平台: song.platform, songmid: song.songmid } : '没拿到'

if (song) {
  for (const platform of [song.platform, 'kg', 'wy', 'tx', 'kw']) {
    const s = { ...song, platform }
    try {
      const lyric = await window.api.player.getLyric(s)
      out['歌词_' + platform] = lyric
        ? {
            有歌词: Boolean(lyric.lyric),
            长度: (lyric.lyric ?? '').length,
            前两行: (lyric.lyric ?? '').split('\n').slice(0, 2),
            有译文: Boolean(lyric.tlyric)
          }
        : null
    } catch (e) {
      out['歌词_' + platform] = '抛错: ' + String(e.message).slice(0, 120)
    }
    await sleep(300)
  }
}

return JSON.stringify(out, null, 1)
