/**
 * cover-fix 专用 CDP 客户端（端口 9223）。
 *
 * 为什么不直接用 scripts/cdp.mjs：那个脚本把 9222 写死了，而 9222 是播放器
 * 队友在用的实例。这里单独一份，端口可用环境变量覆盖。
 *
 * 用法：
 *   node scripts/cover-fix-cdp.mjs evalfile scripts/cover-fix-xxx.mjs
 *   node scripts/cover-fix-cdp.mjs eval "1+1"
 */
const PORT = Number(process.env.COVER_CDP_PORT || 9223)

async function pickPage() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const list = await res.json()
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('找不到渲染进程 target')
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

const cmd = process.argv[2] ?? 'eval'
const page = await pickPage()
const cdp = await connect(page.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')

let value
if (cmd === 'evalfile') {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(process.argv[3], 'utf8')
  value = await evaluate(cdp, `(async () => { ${src} })()`)
} else {
  value = await evaluate(cdp, process.argv[3] ?? '1')
}

console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1))
cdp.close()
process.exit(0)
