/**
 * 渲染性能探针用的 CDP 客户端（render-perf 专用，端口 9225）。
 *
 * scripts/cdp.mjs 把端口硬编码成 9222，四个队友会互相抢；
 * 这里做成参数化，默认 9225，避免和队友冲突。
 *
 * 用法：
 *   node scripts/perf-cdp.mjs ping
 *   node scripts/perf-cdp.mjs eval "<表达式>"
 *   node scripts/perf-cdp.mjs evalfile <脚本文件.mjs>
 */

const PORT = Number(process.env.PERF_CDP_PORT || 9225)

async function pickPage() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const list = await res.json()
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error(`端口 ${PORT} 上没有找到渲染进程 target`)
  return page
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let id = 0
    const pending = new Map()

    ws.addEventListener('open', () =>
      resolve({
        send(method, params) {
          return new Promise((res, rej) => {
            const mid = ++id
            pending.set(mid, { res, rej })
            ws.send(JSON.stringify({ id: mid, method, params }))
          })
        },
        close: () => ws.close()
      })
    )
    ws.addEventListener('error', () => reject(new Error('WS 连接失败')))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) rej(new Error(JSON.stringify(msg.error)))
        else res(msg.result)
      }
    })
  })
}

async function evaluate(cdp, expression, awaitPromise = true) {
  const out = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  })
  if (out.exceptionDetails) {
    const d = out.exceptionDetails
    throw new Error(d.exception?.description ?? d.text ?? '页面内执行异常')
  }
  return out.result?.value
}

const cmd = process.argv[2] ?? 'ping'
const page = await pickPage()
const cdp = await connect(page.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')

if (cmd === 'ping') {
  console.log(JSON.stringify({ ok: true, port: PORT, title: page.title, url: page.url }))
} else if (cmd === 'eval') {
  const value = await evaluate(cdp, process.argv[3] ?? '1')
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
} else if (cmd === 'evalfile') {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(process.argv[3], 'utf8')
  const value = await evaluate(cdp, `(async () => { ${src} })()`)
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
} else {
  throw new Error(`未知命令: ${cmd}`)
}

cdp.close()
process.exit(0)
