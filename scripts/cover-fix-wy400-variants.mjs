/**
 * 网易云那 3 张 400 的封面，逐个变体试：
 *   直连 / 去掉 param / 换 param 尺寸 / 走本地代理（带与不带 Referer）
 * 目标：找出一个「内容不变、只是换个取法」的可用形态，而不是放弃这 3 张图。
 */
const BAD = [
  'https://p3.music.126.net/-XS4M6guL1L7IbdMkdFcFw==/109951170501372100.jpg?param=300y300',
  'https://p3.music.126.net/qgesMgF8uV0kNzYoBbSE2g==/109951170702056880.jpg?param=300y300',
  'https://p3.music.126.net/CDQ-vJpS-g3oelCzq5I_iw==/109951168144493660.jpg?param=300y300'
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const info = await window.api.app.info()
const port = info?.proxyPort ?? 0

function base64url(text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function loadImg(url, referrerPolicy = 'no-referrer') {
  return new Promise((resolve) => {
    const img = new Image()
    img.referrerPolicy = referrerPolicy
    const timer = setTimeout(() => resolve('timeout'), 12000)
    img.onload = () => {
      clearTimeout(timer)
      resolve(`OK ${img.naturalWidth}x${img.naturalHeight}`)
    }
    img.onerror = () => {
      clearTimeout(timer)
      resolve('FAIL')
    }
    img.src = url
  })
}

function proxied(url, referer) {
  const p = new URLSearchParams()
  p.set('u', base64url(url))
  if (referer) p.set('r', referer)
  return `http://127.0.0.1:${port}/stream?${p.toString()}`
}

const out = []
for (const url of BAD) {
  const noParam = url.replace(/\?param=\d+[xy]\d+/, '')
  const p500 = url.replace(/param=\d+[xy]\d+/, 'param=500y500')
  const p130 = url.replace(/param=\d+[xy]\d+/, 'param=130y130')
  const p200 = url.replace(/param=\d+[xy]\d+/, 'param=200y200')
  const entry = {
    地址尾部: url.slice(-46),
    直连原样: await loadImg(url),
    直连去param: await loadImg(noParam),
    '直连param=500y500': await loadImg(p500),
    '直连param=130y130': await loadImg(p130),
    '直连param=200y200': await loadImg(p200),
    代理带网易Referer: await loadImg(proxied(url, 'https://music.163.com/')),
    代理不带Referer: await loadImg(proxied(url, '')),
    代理去param带Referer: await loadImg(proxied(noParam, 'https://music.163.com/'))
  }
  out.push(entry)
  await sleep(200)
}

/* 对照：同形态但在应用里加载成功的一张，确认不是「所有 wy 都坏」 */
const good = 'https://p3.music.126.net/neKfyKpJHCils8eDsgu2sg==/109951165671182690.jpg?param=300y300'
out.push({ 地址尾部: `对照(已知可用) ${good.slice(-42)}`, 直连原样: await loadImg(good) })

return JSON.stringify(out, null, 1)
