/**
 * 收尾核对：基线里那 6 行「永远加载不出来」的歌，在冻结版里逐个复查。
 * （刀马旦在基线是「有 picUrl 但图挂了」，其余 5 首是「平台压根没给封面」。）
 */
const NAMES = [
  '刀马旦',
  '稻香 (完整版|DJ Ray版)',
  '夜曲 (升调版伴奏)',
  '烟花易冷 (片段)',
  '淘汰 (2007上海演唱会)',
  '兰亭序+微微辣 (DJ版)'
]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function store() {
  const vueApp = document.querySelector('#app')?.__vue_app__
  return vueApp?.config?.globalProperties?.$pinia?._s?.get?.('search') ?? null
}

location.hash = '#/search'
await sleep(500)
const input = document.querySelector('.search-box input')
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
setter.call(input, '周杰伦')
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(150)
document.querySelector('.search-box button.primary')?.click()
for (let i = 0; i < 40; i += 1) {
  await sleep(500)
  if (document.querySelectorAll('.results .row').length >= 100) break
}
const scroller = document.querySelector('.results .body')
if (scroller) {
  const step = Math.max(200, Math.floor(scroller.clientHeight * 0.7))
  for (let top = 0; top <= scroller.scrollHeight; top += step) {
    scroller.scrollTop = top
    await sleep(300)
  }
  scroller.scrollTop = 0
}
await sleep(10000)

const songs = store()?.visibleSongs ?? []
const domRows = [...document.querySelectorAll('.results .row')]
const out = []
for (const name of NAMES) {
  const hits = []
  songs.forEach((s, i) => {
    if (s.name !== name) return
    const img = domRows[i]?.querySelector('.mini-cover img')
    hits.push({
      歌手: s.singer,
      平台: s.platform,
      平台有封面: !!s.picUrl,
      显示地址: img ? String(img.getAttribute('src')).slice(0, 62) : '(占位图标)',
      走了补图: !!s.picUrl && img ? String(img.getAttribute('src')) !== String(s.picUrl) : !!img,
      加载成功: !!img && img.complete && img.naturalWidth > 0,
      尺寸: img ? `${img.naturalWidth}x${img.naturalHeight}` : '-'
    })
  })
  out.push({ 歌名: name, 命中行数: hits.length, 明细: hits })
}
return JSON.stringify({ 结果行数: domRows.length, 目标: out }, null, 1)
