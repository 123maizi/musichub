/**
 * 网易云封面 400 排查（Lead 报告：p3.music.126.net 返回 400，走代理也 400）。
 *
 * 做法：把多个关键词的所有封面地址收集起来，逐个用 <img> 真加载一遍，
 * 把失败的 URL 原样打出来，并按「主机 + 是否带 param + 是否含特殊字符」归类，
 * 这样才能定位到底是哪一类 URL 被 CDN 拒绝。
 */
const KEYWORDS = ['周杰伦', '邓紫棋', 'Taylor Swift', '五月天']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function loadImg(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.referrerPolicy = 'no-referrer'
    const timer = setTimeout(() => resolve({ ok: false, why: 'timeout' }), 15000)
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

const byPlatform = {}
const seen = new Set()
for (const kw of KEYWORDS) {
  const res = await window.api.search.search({ keyword: kw, page: 1, limit: 30 })
  for (const g of res.platforms) {
    for (const s of g.songs) {
      if (!s.picUrl) continue
      const url = String(s.picUrl)
      if (seen.has(`${g.platform}|${url}`)) continue
      seen.add(`${g.platform}|${url}`)
      ;(byPlatform[g.platform] ??= []).push({ url, name: s.name })
    }
  }
}

const report = {}
for (const [platform, items] of Object.entries(byPlatform)) {
  const failures = []
  const shapes = {}
  const sample = items.slice(0, 200)
  for (const item of sample) {
    let shape = item.url.split('/').slice(0, 3).join('/')
    shape += item.url.includes('?param=') ? ' ?param=' : ' (无param)'
    if (item.url.includes('+')) shape += ' 含+号'
    if (item.url.includes('==')) shape += ' 含=='
    shapes[shape] = (shapes[shape] ?? 0) + 1

    const r = await loadImg(item.url)
    if (!r.ok) failures.push({ url: item.url, name: item.name, why: r.why })
  }
  report[platform] = { 总数: sample.length, 失败: failures.length, 失败明细: failures.slice(0, 8), 形态分布: shapes }
}
return JSON.stringify(report, null, 1)
