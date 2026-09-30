/**
 * 定位「请求风暴」的触发源：逐个路由访问，统计每次产生多少条酷我失败日志。
 * 只读日志文件行数做差值，不改任何东西。
 */
import { readFileSync } from 'node:fs'

const LOG = process.argv[2] || 'F:\\MusicHub\\.tmp\\lead-profile\\musichub.log'
const PORT = Number(process.argv[3] || 9222)
const BASE = `http://127.0.0.1:${PORT}`

const countKwFailures = () => {
  try {
    const txt = readFileSync(LOG, 'utf8')
    return (txt.match(/酷我音乐 搜索失败/g) ?? []).length
  } catch {
    return -1
  }
}

const list = await (await fetch(`${BASE}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
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

const base = countKwFailures()
console.log(`起始酷我失败计数: ${base}\n`)

const routes = [
  ['#/search', '搜索页'],
  ['#/artists', '艺人页'],
  ['#/albums', '专辑页'],
  ['#/library', '音乐库'],
  ['#/sources', '音源页'],
  ['#/settings', '设置页'],
  ['#/downloads', '下载页'],
  ['#/nowplaying', '正在播放']
]

for (const [hash, name] of routes) {
  const before = countKwFailures()
  await inPage(`window.location.hash = ${JSON.stringify(hash)}; return 1`)
  await sleep(7000)
  const after = countKwFailures()
  console.log(`${name.padEnd(8)} ${hash.padEnd(14)} 新增失败 ${after - before}`)
}

ws.close()
