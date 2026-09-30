/**
 * 控制台异常扫描器。
 *
 * 静态读代码能看出逻辑问题，但看不出「切到某个页面就抛异常」这类运行时暗病。
 * 这个脚本挂上 CDP 的 Runtime/Runtime.exceptionThrown + Log 域，
 * 然后依次走遍所有路由，把渲染进程里发生的 JS 异常、console.error、
 * 以及浏览器层警告（比如图片加载失败、CSP 拦截）全部收集起来。
 *
 * 用法: node scripts/scan-console-errors.mjs [port]
 */
const PORT = Number(process.argv[2] || 9222)
const BASE = `http://127.0.0.1:${PORT}`

const list = await (await fetch(`${BASE}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
if (!page) {
  console.error('找不到页面')
  process.exit(2)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const events = []

await new Promise((r, j) => {
  ws.onopen = r
  ws.onerror = j
})

ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    return
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    events.push({
      kind: '未捕获异常',
      text: d.exception?.description ?? d.text ?? '',
      at: `${d.url ?? ''}:${d.lineNumber ?? 0}`
    })
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    events.push({
      kind: m.params.type === 'error' ? 'console.error' : 'console.warn',
      text: (m.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' '),
      at: (m.params.stackTrace?.callFrames?.[0]?.url ?? '') + ':' + (m.params.stackTrace?.callFrames?.[0]?.lineNumber ?? '')
    })
  }
  if (m.method === 'Log.entryAdded') {
    const en = m.params.entry
    if (en.level === 'error' || en.level === 'warning') {
      events.push({ kind: `Log.${en.level}`, text: `${en.text} ${en.url ?? ''}`, at: en.url ?? '' })
    }
  }
}

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

const inPage = async (code) => {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${code} })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result?.value
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')

const routes = [
  ['#/search', '搜索'],
  ['#/downloads', '下载'],
  ['#/library', '音乐库'],
  ['#/sources', '音源'],
  ['#/settings', '设置'],
  ['#/artist', '艺人'],
  ['#/album', '专辑'],
  ['#/now-playing', '正在播放']
]

console.log(`扫描端口 ${PORT} 的渲染进程…\n`)

// 先做一次搜索，让列表类页面有内容可渲染
await inPage(`
  window.location.hash = '#/search'
  await new Promise(r => setTimeout(r, 1500))
  const input = document.querySelector('.search-box input')
  if (input) {
    input.focus(); input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 150))
    input.value = '周杰伦'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  }
  return 1
`)
await sleep(9000)

for (const [hash, name] of routes) {
  const before = events.length
  try {
    await inPage(`window.location.hash = ${JSON.stringify(hash)}; await new Promise(r => setTimeout(r, 100)); return 1`)
    await sleep(3200)
  } catch (err) {
    events.push({ kind: '路由切换失败', text: String(err?.message ?? err), at: hash })
  }
  const added = events.length - before
  console.log(`${added === 0 ? '干净' : `发现 ${added} 条`}  ${name}  ${hash}`)
}

ws.close()

console.log('')
console.log('='.repeat(72))
if (events.length === 0) {
  console.log('全部路由无异常、无 error 级日志')
} else {
  console.log(`共 ${events.length} 条异常/告警：`)
  const seen = new Set()
  for (const e of events) {
    const key = `${e.kind}|${e.text.slice(0, 120)}`
    if (seen.has(key)) continue
    seen.add(key)
    console.log('')
    console.log(`[${e.kind}] ${e.text.slice(0, 300)}`)
    if (e.at) console.log(`    位置: ${e.at}`)
  }
}
process.exit(events.length > 0 ? 1 : 0)
