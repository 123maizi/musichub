/**
 * 在成品里抓一个真 MP3 出来（音源有时给 m4a，多试几首/几档），
 * 拿到就把路径交回去给系统解码器验。
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

const attempts = [
  { q: 'Corbon Amodio lucy', quality: '128k' },
  { q: 'Mama\u0027s Boy Ratter', quality: '128k' },
  { q: '周杰伦 稻香', quality: '128k' },
  { q: 'Corbon Amodio lucy', quality: '320k' },
  { q: 'Meant To Be Cuntsniffer', quality: '128k' }
]

const results = []
for (const a of attempts) {
  const r = await evaluate(`
    await window.api.download.setConfig({ preferQuality: ${JSON.stringify(a.quality)} })
    window.location.hash = '#/search'
    await new Promise(r => setTimeout(r, 2200))
    const input = document.querySelector('.search-box input')
    input.focus(); input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 150))
    input.value = ${JSON.stringify(a.q)}
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    let rows = []
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 1000))
      rows = [...document.querySelectorAll('.results .row')]
      if (rows.length) break
    }
    if (!rows.length) return { 搜索: '无结果' }
    const before = await window.api.download.list()
    rows[0].querySelector('.col-actions button[title^="下载为"]')?.click()
    let t = null
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 700))
      const all = await window.api.download.list()
      const fresh = all.filter(x => !before.some(b => b.id === x.id))
      if (fresh.length) { t = fresh[0]; break }
    }
    if (!t) return { 搜索: '没入队' }
    for (let i = 0; i < 180; i++) {
      await new Promise(r => setTimeout(r, 1000))
      t = (await window.api.download.list()).find(x => x.id === t.id)
      if (t && ['done','error'].includes(t.status)) break
    }
    return { 文件: t.fileName, 状态: t.status, 错误: t.error ?? null, 路径: t.savePath }
  `)
  results.push({ 尝试: `${a.q} @${a.quality}`, ...r })
  if (r && String(r.文件 ?? '').toLowerCase().endsWith('.mp3') && r.状态 === 'done') break
}

ws.close()
console.log(JSON.stringify(results, null, 1))
