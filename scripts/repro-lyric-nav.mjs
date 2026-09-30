/**
 * 复现验收脚本里的序列：搜索页点播放 → 切到播放页 → 轮询歌词。
 * 带上详细诊断，弄清楚「hash 变了但 DOM 没换」到底发生了什么。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

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
document.querySelector('.results .row .col-actions button[title="播放"]')?.click()
await sleep(6000)

out['播放后'] = {
  hash: location.hash,
  view数量: document.querySelectorAll('.view').length,
  view的class: [...document.querySelectorAll('.view')].map((v) => v.className),
  nowplaying存在: document.querySelectorAll('.stage').length,
  search存在: document.querySelectorAll('.results').length,
  歌词行: document.querySelectorAll('.lyric-line').length
}

// 切到播放页 —— 和验收脚本完全一样的方式
window.location.hash = '#/now-playing'
const timeline = []
for (let i = 0; i < 8; i += 1) {
  await sleep(1000)
  timeline.push({
    秒: i + 1,
    hash: location.hash,
    view的class: [...document.querySelectorAll('.view')].map((v) => v.className).join(','),
    stage: document.querySelectorAll('.stage').length,
    lyric行: document.querySelectorAll('.lyric-line').length,
    lyricempty: document.querySelectorAll('.lyric-empty').length
  })
}
out['切换后时间线'] = timeline
out['最终view'] = [...document.querySelectorAll('.view')].map((v) => ({
  class: v.className,
  首段文本: v.innerText.replace(/\s+/g, ' ').slice(0, 80)
}))
out['body前200字'] = document.body.innerText.replace(/\s+/g, ' ').slice(0, 200)

return JSON.stringify(out, null, 1)
