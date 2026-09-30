/**
 * 针对 Lead 报的网易云 400：在真实列表里确认这几行现在**有可用封面**，
 * 而且是「同一个歌名歌手」的封面（走跨平台补图），不是裂图也不是乱挂。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TARGETS = ['温柔', '步步', '刀马旦']
const KEYWORDS = ['五月天', '周杰伦']

function store() {
  const vueApp = document.querySelector('#app')?.__vue_app__
  return vueApp?.config?.globalProperties?.$pinia?._s?.get?.('search') ?? null
}

const rows = []
for (const kw of KEYWORDS) {
  location.hash = '#/search'
  await sleep(400)
  const input = document.querySelector('.search-box input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, kw)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(150)
  document.querySelector('.search-box button.primary')?.click()

  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    if (document.querySelectorAll('.results .row').length >= 100) break
  }
  // 必须先滚一遍：小封面是 loading="lazy"，不滚到那儿浏览器压根不发请求
  const scroller = document.querySelector('.results .body')
  if (scroller) {
    const step = Math.max(200, Math.floor(scroller.clientHeight * 0.7))
    for (let top = 0; top <= scroller.scrollHeight; top += step) {
      scroller.scrollTop = top
      await sleep(300)
    }
    scroller.scrollTop = 0
  }
  await sleep(9000)

  const songs = store()?.visibleSongs ?? []
  const domRows = [...document.querySelectorAll('.results .row')]
  domRows.forEach((row, i) => {
    const song = songs[i]
    if (!song || !TARGETS.includes(song.name)) return
    if (song.platform !== 'wy') return
    const img = row.querySelector('.mini-cover img')
    const src = img ? String(img.getAttribute('src')) : ''
    rows.push({
      关键词: kw,
      歌名: song.name,
      歌手: song.singer,
      平台: song.platform,
      平台封面: String(song.picUrl || '').slice(-40),
      实际显示: src ? src.slice(0, 60) : '(占位图标)',
      走了补图: !!song.picUrl && src !== String(song.picUrl),
      加载成功: !!img && img.complete && img.naturalWidth > 0,
      尺寸: img ? `${img.naturalWidth}x${img.naturalHeight}` : '-'
    })
  })
}
return JSON.stringify({ 命中目标行: rows.length, 明细: rows }, null, 1)
