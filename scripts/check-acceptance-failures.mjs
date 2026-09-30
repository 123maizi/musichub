/**
 * 集成复核：确认 3 项失败是「产品回归」还是「探针选择器过时」。
 * 直接看现在的 DOM 长什么样，不猜。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

// 1. 搜索页：行内操作按钮的 title / class
window.location.hash = '#/search'
await sleep(2500)
const rows = [...document.querySelectorAll('.results .row')]
out.搜索结果 = {
  行数: rows.length,
  首行按钮: rows[0]
    ? [...rows[0].querySelectorAll('button')].map((b) => ({
        title: b.getAttribute('title') ?? '',
        class: b.className,
        文字: (b.innerText || '').trim().slice(0, 8)
      }))
    : []
}

// 2. 下载页顶部操作区（现在走 Teleport 到顶栏）
out.顶栏操作 = [...document.querySelectorAll('#page-actions button, #page-actions .btn')].map((b) => ({
  title: b.getAttribute('title') ?? '',
  文字: (b.innerText || '').trim().slice(0, 12)
}))

// 3. 正在播放页：歌词行的真实类名
rows[0]?.querySelector('.col-actions button[title^="播放"], .col-actions button')?.click()
await sleep(3000)
window.location.hash = '#/now-playing'
await sleep(3000)
const page = document.querySelector('.page')
out.正在播放 = {
  路由: window.location.hash,
  文本长度: (page?.innerText ?? '').trim().length,
  歌词相关类名统计: (() => {
    const map = {}
    for (const el of page?.querySelectorAll('*') ?? []) {
      const c = typeof el.className === 'string' ? el.className : ''
      for (const k of c.split(/\s+/)) {
        if (/lyric|line|active|translate|trans/i.test(k)) map[k] = (map[k] ?? 0) + 1
      }
    }
    return map
  })(),
  '有「暂时没有歌词」提示': /暂时没有歌词|没有歌词/.test(page?.innerText ?? ''),
  有翻译按钮: [...(page?.querySelectorAll('button') ?? [])].some((b) => /翻译/.test(b.innerText + (b.title ?? ''))),
  按钮文字: [...(page?.querySelectorAll('button') ?? [])].map((b) => (b.innerText || b.title || '').trim().slice(0, 10)).filter(Boolean).slice(0, 14)
}

window.location.hash = '#/search'
return JSON.stringify(out, null, 1)
