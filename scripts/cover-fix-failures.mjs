/**
 * 对基线里 6 行没封面的歌，逐个问主进程「补图到底返回了什么」，
 * 并且把返回的地址真的塞进 <img> 试加载 ——
 * 这样才能区分两种完全不同的失败：
 *   A 主进程返回 null（搜不到 / 挑中的候选没封面字段）
 *   B 主进程返回了地址，但那个地址本身加载不出来（防盗链 / 404 / 假图）
 */
const NAMES = [
  '刀马旦',
  '稻香 (完整版|DJ Ray版)',
  '夜曲 (升调版伴奏)',
  '烟花易冷 (片段)',
  '淘汰 (2007上海演唱会)',
  '兰亭序+微微辣 (DJ版)'
]

const res = await window.api.search.search({ keyword: '周杰伦', page: 1, limit: 30 })
const all = res.platforms.flatMap((g) => g.songs)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function loadImg(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.referrerPolicy = 'no-referrer'
    const timer = setTimeout(() => resolve({ ok: false, why: 'timeout' }), 12000)
    img.onload = () => {
      clearTimeout(timer)
      resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight })
    }
    img.onerror = () => {
      clearTimeout(timer)
      resolve({ ok: false, why: 'error' })
    }
    img.src = url
  })
}

const out = []
for (const name of NAMES) {
  const song = all.find((s) => s.name === name)
  if (!song) {
    out.push({ 歌名: name, 结论: '搜索结果里找不到这首' })
    continue
  }
  const entry = {
    歌名: song.name,
    平台: song.platform,
    平台封面: song.picUrl || '(空)'
  }
  if (song.picUrl) {
    entry.平台封面可加载 = await loadImg(song.picUrl)
  }
  try {
    const url = await window.api.player.resolveCover(song)
    entry.补图返回 = url || null
    if (url) entry.补图可加载 = await loadImg(url)
  } catch (e) {
    entry.补图返回 = 'ERR ' + String(e.message).slice(0, 80)
  }
  out.push(entry)
  await sleep(200)
}

return JSON.stringify(out, null, 1)
