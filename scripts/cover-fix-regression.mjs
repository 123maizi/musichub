/**
 * 回归探针：确认封面链路的改动没有破坏其它功能，并且把三条兜底路径都实测一遍。
 *
 *  1. 大图场景（正在播放页）：bigCoverUrl 应当把平台小图换成大图，且真的能加载
 *  2. 播放条缩略图：同一首歌的小图也要能出来
 *  3. 本地流代理兜底：代理地址确实能取到图（防盗链兜底依赖它）
 *  4. 歌词 / 收藏 / 封面下载 三个既有能力
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function pinia() {
  return document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia
}

function loadImg(url, referrerPolicy = 'no-referrer') {
  return new Promise((resolve) => {
    const img = new Image()
    img.referrerPolicy = referrerPolicy
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

function base64url(text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const out = {}

/* 先拿一首有真实封面的歌（酷我 / 腾讯各一个，覆盖两种大图替换规则） */
const res = await window.api.search.search({ keyword: '周杰伦', page: 1, limit: 30 })
const all = res.platforms.flatMap((g) => g.songs)
const kwSong = all.find((s) => s.platform === 'kw' && s.picUrl)
const txSong = all.find((s) => s.platform === 'tx' && s.picUrl)
const wySong = all.find((s) => s.platform === 'wy' && s.picUrl)

/* ------------------ 1. 大图场景：把 current 放进 player store ------------------ */
const player = pinia()?._s?.get('player')
if (!player) {
  out['0_播放器store'] = '找不到了'
} else {
  location.hash = '#/now-playing'
  await sleep(1200)

  const samples = []
  for (const song of [kwSong, txSong, wySong].filter(Boolean)) {
    player.current = { ...song }
    await sleep(2500)
    const img = document.querySelector('.cover img')
    samples.push({
      平台: song.platform,
      平台地址: String(song.picUrl).slice(0, 78),
      大图地址: img ? String(img.getAttribute('src')).slice(0, 78) : '(没有 img)',
      加载成功: img ? img.complete && img.naturalWidth > 0 : false,
      尺寸: img ? `${img.naturalWidth}x${img.naturalHeight}` : '-'
    })
  }
  out['1_正在播放大图'] = samples

  /* ------------------ 2. 播放条缩略图 ------------------ */
  location.hash = '#/search'
  await sleep(1500)
  const bar = document.querySelector('.player-bar .cover img, .playbar .cover img, .cover img')
  out['2_播放条缩略图'] = bar
    ? { src: String(bar.getAttribute('src')).slice(0, 70), 加载成功: bar.complete && bar.naturalWidth > 0 }
    : '(没找到播放条封面)'
}

/* ------------------ 3. 本地流代理取封面（防盗链兜底） ------------------ */
const info = await window.api.app.info()
const proxyPort = info?.proxyPort ?? 0
const proxySample = kwSong ?? txSong ?? wySong ?? all.find((s) => s.picUrl)
if (proxySample && proxyPort) {
  const proxied = `http://127.0.0.1:${proxyPort}/stream?u=${base64url(String(proxySample.picUrl))}&r=${encodeURIComponent('https://www.kugou.com/')}`
  out['3_代理取封面'] = {
    端口: proxyPort,
    样本: `${proxySample.platform} ${proxySample.name}`,
    ...(await loadImg(proxied, 'no-referrer'))
  }
} else {
  out['3_代理取封面'] = `跳过（proxyPort=${proxyPort}）`
}

/* ------------------ 4. 既有能力：歌词 / 收藏 / 封面下载 ------------------ */
if (txSong) {
  const lyric = await window.api.player.getLyric({ ...txSong }).catch((e) => ({ err: String(e.message) }))
  out['4_歌词'] = {
    有歌词: Boolean(lyric?.lyric && String(lyric.lyric).length > 10),
    长度: lyric?.lyric ? String(lyric.lyric).length : 0,
    err: lyric?.err ?? null
  }

  const before = await window.api.library.snapshot()
  const wasFav = (before?.favorites ?? []).some((s) => s.id === txSong.id)
  await window.api.library.toggleFavorite({ ...txSong })
  const after = await window.api.library.snapshot()
  const nowFav = (after?.favorites ?? []).some((s) => s.id === txSong.id)
  // 再切一次复原，别给用户留垃圾数据
  await window.api.library.toggleFavorite({ ...txSong })
  const restored = await window.api.library.snapshot()
  const backFav = (restored?.favorites ?? []).some((s) => s.id === txSong.id)
  out['4_收藏'] = { 原本已收藏: wasFav, 切换后: nowFav, 再切回: backFav, 状态复原: wasFav === backFav }

  const dl = await window.api.player
    .downloadCover({ ...txSong }, 'F:\\MusicHub\\.tmp\\cover-fix-downloads')
    .catch((e) => ({ err: String(e.message) }))
  out['4_封面下载'] = dl?.err
    ? { err: dl.err }
    : { 路径: dl.path, 字节: dl.bytes, 来源: dl.from }
}

return JSON.stringify(out, null, 1)
