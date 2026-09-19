/**
 * 48 秒到底是「音源给的试听片段」还是「本地代理截断」？
 *
 * 同一个地址取两次时长：
 *   A. 经过本地代理（http://127.0.0.1:PORT/stream?u=<base64>）
 *   B. 绕过代理，直连原始地址
 * 两者一致 → 是音源那边就只有 48 秒
 * 直连更长  → 是我们的代理在截断（那就是自家 bug，且会连带影响下载）
 */
const list = await window.api.search.search({ keyword: '蛋堡', limit: 20 })
const songs = list.platforms.flatMap((p) => p.songs).slice(0, 3)

function durationOf(url, headers) {
  return new Promise((resolve) => {
    const a = document.createElement('audio')
    a.preload = 'metadata'
    const t = setTimeout(() => resolve('超时'), 9000)
    a.onloadedmetadata = () => {
      clearTimeout(t)
      resolve(Math.round(a.duration * 10) / 10)
    }
    a.onerror = () => {
      clearTimeout(t)
      resolve('加载失败')
    }
    a.src = url
  })
}

const rows = []
for (const song of songs) {
  const res = await window.api.player.getUrl({ song, quality: '320k' })
  const proxied = res.url

  // 从代理地址里取回原始地址：u 参数是 base64
  let direct = null
  try {
    const u = new URL(proxied).searchParams.get('u')
    direct = u ? atob(u.replace(/-/g, '+').replace(/_/g, '/')) : null
  } catch {
    direct = null
  }

  rows.push({
    name: song.name,
    meta: song.duration,
    src: res.sourceName,
    经过代理: await durationOf(proxied),
    直连原址: direct ? await durationOf(direct) : '（地址里没有 u 参数，可能不是代理地址）',
    directHost: direct ? direct.slice(0, 60) : null
  })
}

return JSON.stringify(rows, null, 1)
