/** 自愈重试的事后检查：延迟重试到点之后，那些「第一轮失败」的行有没有自己好 */
const rows = [...document.querySelectorAll('.results .row')]
const vueApp = document.querySelector('#app')?.__vue_app__
const songs = vueApp?.config?.globalProperties?.$pinia?._s?.get('search')?.visibleSongs ?? []

const out = []
rows.forEach((row, i) => {
  const img = row.querySelector('.mini-cover img')
  const loaded = !!img && img.complete && img.naturalWidth > 0
  if (loaded) return
  out.push({
    行: i + 1,
    歌名: songs[i]?.name ?? '?',
    平台: songs[i]?.platform ?? '?',
    有平台封面: !!songs[i]?.picUrl,
    状态: img ? 'img 存在但没加载出来' : '占位图标'
  })
})
return JSON.stringify({ 仍未加载: out.length, 明细: out }, null, 1)
