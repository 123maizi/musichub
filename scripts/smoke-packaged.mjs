/**
 * 对打包后的成品做冒烟验证：走一遍真实 IPC，确认这一版的功能确实进包了。
 * 用法: node scripts/smoke-packaged.mjs [port]
 */
const PORT = Number(process.argv[2] || 9333)
const base = `http://127.0.0.1:${PORT}`

const list = await (await fetch(`${base}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
if (!page) throw new Error('没找到页面')

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
out['1_版本'] = await evaluate(`return navigator.userAgent.match(/musichub\\/[\\d.]+/)?.[0] ?? null`)

/* 这一版新增的 IPC：文件体检 */
out['2_文件体检IPC'] = await evaluate(
  `return typeof window.api?.download?.audit === 'function'`
)
out['3_体检结果样例'] = await evaluate(
  `const a = await window.api.download.audit(); return { 条目数: Object.keys(a ?? {}).length, 有字段: Object.values(a ?? {})[0] ?? null }`
)

/* 下载格式选择器：下载页 + 搜索页 */
out['4_下载页格式按钮'] = await evaluate(`
  window.location.hash = '#/downloads'
  await new Promise(r => setTimeout(r, 2500))
  return [...document.querySelectorAll('.fmt .opt')].map(b => b.innerText.replace(/\\s+/g,' ').trim())
`)
out['5_当前选中'] = await evaluate(
  `return [...document.querySelectorAll('.fmt .opt.active')].map(b => b.innerText.replace(/\\s+/g,' ').trim())`
)
out['6_配置里的格式'] = await evaluate(
  `return (await window.api.download.getConfig()).preferQuality`
)
out['7_搜索页有紧凑选择器'] = await evaluate(`
  window.location.hash = '#/search'
  await new Promise(r => setTimeout(r, 2000))
  return Boolean(document.querySelector('.fmt-inline .fmt.compact'))
`)

/* 换目录后老目录还能不能播 —— 这一版的核心修复 */
out['8_本地取流白名单'] = await evaluate(`
  const cfg = await window.api.download.getConfig()
  const file = cfg.dir + '\\\\Mama\\'s Boy - Ratter.mp3'
  try {
    const r = await window.api.player.getUrl({
      song: { id: 'local_x', platform: 'local', songmid: file, localPath: file, name: 'x', singer: 'y', albumName: '', duration: 100, qualities: ['320k'] },
      quality: '320k'
    })
    const res = await fetch(r.url, { headers: { Range: 'bytes=0-1023' } })
    return 'HTTP ' + res.status
  } catch (e) { return 'err: ' + String(e.message).slice(0, 60) }
`)

ws.close()
console.log(JSON.stringify(out, null, 1))
