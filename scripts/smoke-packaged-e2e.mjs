/**
 * 打包成品端到端：新用户第一次打开 → 搜到歌 → 下载 → 文件落盘 → 能播。
 * 这条链路同时验证内置音源随包分发是有效的。
 */
const PORT = Number(process.argv[2] || 9333)
const base = `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`${base}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
await new Promise((r) => (ws.onopen = r))
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const i = ++id
    pending.set(i, { resolve, reject })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${expr} })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  }
  return r.result?.value
}
await send('Runtime.enable')

const out = {}

out['1_内置音源数'] = await evaluate(
  `const s = await window.api.source.list(); return Array.isArray(s) ? s.length : Object.keys(s ?? {}).length`
)
out['2_可用音源'] = await evaluate(
  `const s = await window.api.source.list(); const arr = Array.isArray(s) ? s : [];
   return arr.filter(x => x.enabled !== false).map(x => x.name).slice(0, 8)`
)

/* 搜索 */
out['3_搜索结果数'] = await evaluate(`
  window.location.hash = '#/search'
  await new Promise(r => setTimeout(r, 2200))
  const input = document.querySelector('.search-box input')
  input.focus(); input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 150))
  input.value = '周杰伦 稻香'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const n = document.querySelectorAll('.results .row').length
    if (n > 0) return n
  }
  return 0
`)

/* 下载 */
out['4_下载结果'] = await evaluate(`
  const rows = [...document.querySelectorAll('.results .row')]
  if (!rows.length) return '没有搜索结果'
  rows[0].querySelector('.col-actions button[title^="下载为"]')?.click()
  let t = null
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 700))
    const all = await window.api.download.list()
    if (all.length) { t = all[0]; break }
  }
  if (!t) return '没入队'
  for (let i = 0; i < 180; i++) {
    await new Promise(r => setTimeout(r, 1000))
    t = (await window.api.download.list()).find(x => x.id === t.id)
    if (t && ['done','error'].includes(t.status)) break
  }
  const a = (await window.api.download.audit())?.[t.id]
  return { 文件: t.fileName, 状态: t.status, 错误: t.error ?? null, 存在: a?.exists ?? null, 字节: a?.size ?? null }
`)

/* 播放 */
out['5_播放'] = await evaluate(`
  window.location.hash = '#/downloads'
  await new Promise(r => setTimeout(r, 2500))
  const row = [...document.querySelectorAll('.task')][0]
  if (!row) return '没有任务行'
  const btn = [...row.querySelectorAll('button')].find(b => ['播放','播放中','重新下载'].includes(b.innerText.trim()))
  if (!btn) return '没有播放按钮'
  if (btn.innerText.trim() === '重新下载') return '被标记为文件已丢失'
  btn.click()
  await new Promise(r => setTimeout(r, 5000))
  return {
    时间: document.querySelector('.time-row')?.innerText?.replace(/\\s+/g,' ') ?? '',
    音源: document.querySelector('.src-name')?.innerText?.trim() ?? '',
    出错: document.querySelector('.error-strip')?.innerText?.replace(/\\s+/g,' ').slice(0,70) ?? ''
  }
`)

out['6_任务行格式标签'] = await evaluate(
  `return document.querySelector('.task .line1')?.innerText?.replace(/\\s+/g,' ').trim() ?? ''`
)

ws.close()
console.log(JSON.stringify(out, null, 1))
