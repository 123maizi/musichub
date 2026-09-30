/** 看「我的音乐」和「下载」两页实际渲染了什么 —— 判断是空态还是渲染坏了 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

for (const [label, hash] of [
  ['我的音乐', '#/library'],
  ['下载', '#/downloads']
]) {
  window.location.hash = hash
  await sleep(2200)
  const page = document.querySelector('.page')
  out[label] = {
    路由: window.location.hash,
    文本长度: (page?.innerText ?? '').trim().length,
    全文: (page?.innerText ?? '').trim().slice(0, 400),
    子元素数: page?.querySelectorAll('*').length ?? 0,
    顶层结构: [...(page?.children ?? [])].map((c) => {
      const cls = c.className && typeof c.className === 'string' ? '.' + c.className.split(' ').join('.') : ''
      return c.tagName.toLowerCase() + cls
    }),
    有标签页: (page?.querySelectorAll('[class*="tab"], [role="tab"]').length ?? 0),
    有按钮: [...(page?.querySelectorAll('button') ?? [])].map((b) => (b.innerText || b.title || '').trim().slice(0, 20)).filter(Boolean).slice(0, 8),
    控制台报错: window.__probeErrors ? window.__probeErrors.slice(-5) : '未采集'
  }
}

window.location.hash = '#/search'
return JSON.stringify(out, null, 1)
