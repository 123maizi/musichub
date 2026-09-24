/**
 * 成品冒烟：新装环境里下一首 MP3，把产物路径交回去给系统解码器验。
 * 用法: node scripts/smoke-packaged-mp3.mjs [port]
 */
const PORT = Number(process.argv[2] || 9333)
const base = `http://127.0.0.1:${PORT}`
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result?.value
}
await send('Runtime.enable')

const out = {}
out['版本'] = await evaluate(`return navigator.userAgent.match(/musichub\\/[\\d.]+/)?.[0] ?? null`)
out['格式设为MP3'] = await evaluate(`
  const c = await window.api.download.setConfig({ preferQuality: '320k' })
  return c.preferQuality
`)
out['下载'] = await evaluate(`
  window.location.hash = '#/search'
  await new Promise(r => setTimeout(r, 2200))
  const input = document.querySelector('.search-box input')
  input.focus(); input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 150))
  input.value = 'Corbon Amodio lucy'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  let rows = []
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000))
    rows = [...document.querySelectorAll('.results .row')]
    if (rows.length) break
  }
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
  return { 文件: t.fileName, 状态: t.status, 错误: t.error ?? null, 路径: t.savePath, 字节: a?.size ?? null }
`)

ws.close()
console.log(JSON.stringify(out, null, 1))
