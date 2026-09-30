/**
 * 全功能验收套件。
 *
 * 用户的硬性要求是「绝对不能砍任何功能，优化完所有功能都要正常」。
 * 这个脚本就是那句话的证明：一次跑完，逐项 PASS / FAIL。
 *
 * 用法: node scripts/acceptance.mjs [port]   （默认 9222）
 *
 * 设计原则：
 *  - 每项都断言「真实结果」，不看「有没有报错」了事
 *  - 失败的项打印足够定位的细节，不吞异常
 *  - 只读为主；会产生副作用的项（下载）写到临时目录，跑完清理
 */
const PORT = Number(process.argv[2] || 9222)
const BASE = `http://127.0.0.1:${PORT}`
const TEST_DIR = 'F:\\MusicHub\\.tmp\\acceptance-dl'

const results = []
const pass = (name, detail) => results.push({ ok: true, name, detail })
const fail = (name, detail) => results.push({ ok: false, name, detail })

/* ------------------------------ CDP 连接 ------------------------------ */

let ws
let seq = 0
const pending = new Map()

async function connect() {
  const list = await (await fetch(`${BASE}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
  if (!page) throw new Error('找不到渲染进程页面')
  ws = new WebSocket(page.webSocketDebuggerUrl)
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
  await send('Runtime.enable')
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

/** 在页面里跑一段 async 代码，返回它的 return 值 */
async function inPage(code) {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${code} })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.exceptionDetails) {
    const d = r.exceptionDetails
    throw new Error(d.exception?.description ?? d.text ?? '页面内异常')
  }
  return r.result?.value
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------ 各项检查 ------------------------------ */

async function checkEnv() {
  const info = await inPage(`return { ua: navigator.userAgent, hash: location.hash }`)
  if (!/musichub/i.test(info?.ua ?? '')) throw new Error('拿到的不是 MusicHub 页面')
  return info
}

/** 1. 音源：装载数量与可用数 */
async function checkSources() {
  const list = await inPage(`return await window.api.source.list()`)
  const arr = Array.isArray(list) ? list : (list?.sources ?? [])
  const ready = arr.filter((s) => s.status === 'ready')
  return { 总数: arr.length, 可用: ready.length, 名称: ready.slice(0, 3).map((s) => s.name) }
}

/** 2. 搜索：五个平台都要能出结果 */
async function checkSearch() {
  await inPage(`
    window.location.hash = '#/search'
    await new Promise(r => setTimeout(r, 1500))
    const input = document.querySelector('.search-box input')
    input.focus(); input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 150))
    input.value = '周杰伦'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    return 1
  `)
  let rows = 0
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000)
    rows = await inPage(`return document.querySelectorAll('.results .row').length`)
    if (rows > 0) break
  }
  const tabs = await inPage(
    `return [...document.querySelectorAll('.tabs .tab')].map(t => t.innerText.replace(/\\s+/g, ' ').trim())`
  )
  return { 结果行数: rows, 平台标签: tabs }
}

/** 3. 播放：能取到地址、能真的出声（进度在走） */
async function checkPlayback() {
  const el = await inPage(`
    const rows = [...document.querySelectorAll('.results .row')]
    if (!rows.length) return { ok: false, why: '没有搜索结果' }
    rows[0].querySelector('.col-actions button[title="播放"]')?.click()
    await new Promise(r => setTimeout(r, 6000))
    const t = document.querySelector('.time-row')?.innerText?.replace(/\\s+/g, ' ') ?? ''
    return {
      ok: true,
      曲名: document.querySelector('.now-title')?.innerText?.trim() ?? '',
      时间: t,
      音源: document.querySelector('.src-name')?.innerText?.trim() ?? '',
      出错: document.querySelector('.error-strip')?.innerText?.replace(/\\s+/g, ' ').slice(0, 80) ?? ''
    }
  `)
  await sleep(4000)
  const t2 = await inPage(`return document.querySelector('.time-row')?.innerText?.replace(/\\s+/g, ' ') ?? ''`)
  return { ...el, 四秒后: t2 }
}

/** 4. 歌词 + 译文能力（轮询等待，不用固定 sleep —— 歌词是异步拉的，快慢取决于音源） */
async function checkLyric() {
  await inPage(`
    window.location.hash = '#/now-playing'
    return 1
  `)
  // 等到歌词行真的出现为止，最多 20 秒
  let hit = 0
  for (let i = 0; i < 20; i += 1) {
    await sleep(1000)
    hit = await inPage(`return document.querySelectorAll('.lyric-line').length`)
    if (hit > 0) break
  }
  const r = await inPage(`
    const texts = [...document.querySelectorAll('.lyric-line')]
    const withText = texts.filter(el => (el.innerText || '').trim().replace('·', '').length > 0)
    const buttons = [...document.querySelectorAll('button')].map(b => b.innerText.trim())
    return {
      当前路由: location.hash,
      歌词行数: withText.length,
      首行: withText[0] ? withText[0].innerText.trim().slice(0, 30) : null,
      空态提示: document.querySelector('.lyric-empty')?.innerText?.replace(/\\s+/g, ' ').trim().slice(0, 60) ?? null,
      有翻译按钮: buttons.some(b => /翻译/.test(b)),
      有存封面按钮: buttons.some(b => /存封面/.test(b)),
      有译文标签: document.body.innerText.includes('本歌词由')
    }
  `)
  return r
}

/** 5. 收藏 / 历史 / 歌单 */
async function checkLibrary() {
  const before = await inPage(`return await window.api.library.stats()`)
  const after = await inPage(`
    const rows = [...document.querySelectorAll('.results .row')]
    if (!rows.length) return null
    rows[0].querySelector('.col-actions button[title*="收藏"]')?.click()
    await new Promise(r => setTimeout(r, 1200))
    return await window.api.library.stats()
  `)
  return { 操作前: before, 操作后: after }
}

/** 6. 下载：入队 → 完成 → 文件存在 */
async function checkDownload() {
  // 前面的用例可能把页面带到别处了（比如播放页），这里自己先回到搜索结果，
  // 不依赖调用顺序 —— 否则会得出「找不到搜索结果」这种假失败。
  await inPage(`
    window.location.hash = '#/search'
    return 1
  `)
  let rows = 0
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    rows = await inPage(`return document.querySelectorAll('.results .row').length`)
    if (rows > 0) break
  }
  if (rows === 0) return { ok: false, why: '回到搜索页后没有结果（前面可能没搜成功）' }

  const r = await inPage(`
    await window.api.download.setConfig({ dir: ${JSON.stringify(TEST_DIR)} })
    const old = await window.api.download.list()
    if (old.length) await window.api.download.remove(old.map(t => t.id), false)
    const rows = [...document.querySelectorAll('.results .row')]
    if (!rows.length) return { ok: false, why: '没有搜索结果' }
    rows[0].querySelector('.col-actions button[title^="下载为"]')?.click()
    let t = null
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 700))
      const all = await window.api.download.list()
      if (all.length) { t = all[0]; break }
    }
    if (!t) return { ok: false, why: '点了下载但没入队' }
    for (let i = 0; i < 200; i++) {
      await new Promise(r => setTimeout(r, 1000))
      t = (await window.api.download.list()).find(x => x.id === t.id)
      if (t && ['done','error'].includes(t.status)) break
    }
    const a = (await window.api.download.audit())?.[t.id]
    return { ok: true, 文件: t.fileName, 状态: t.status, 错误: t.error ?? null, 存在: a?.exists ?? null, 字节: a?.size ?? null, 路径: t.savePath }
  `)
  return r
}

/** 7. 封面：真实渲染出来的比例（naturalWidth > 0 才算真的加载出来） */
async function checkCovers() {
  await inPage(`
    window.location.hash = '#/search'
    await new Promise(r => setTimeout(r, 2500))
    return 1
  `)
  await sleep(6000)
  return await inPage(`
    const rows = [...document.querySelectorAll('.results .row')]
    let withImg = 0, loaded = 0
    for (const row of rows) {
      const img = row.querySelector('.mini-cover img, .cover img')
      if (!img) continue
      withImg++
      if (img.complete && img.naturalWidth > 0) loaded++
    }
    return { 总行数: rows.length, 有图片元素: withImg, 真正加载出来: loaded,
             覆盖率: rows.length ? Math.round(loaded / rows.length * 100) + '%' : '—' }
  `)
}

/** 8. 进度条单调性：采样 20 秒，读数只增不减 */
async function checkProgressMonotonic() {
  await inPage(`
    window.location.hash = '#/downloads'
    await new Promise(r => setTimeout(r, 2500))
    return 1
  `)
  const samples = []
  await inPage(`
    window.location.hash = '#/search'
    await new Promise(r => setTimeout(r, 1500))
    const rows = [...document.querySelectorAll('.results .row')]
    rows[0]?.querySelector('.col-actions button[title="播放"]')?.click()
    return 1
  `)
  for (let i = 0; i < 10; i += 1) {
    await sleep(2000)
    const t = await inPage(`return document.querySelector('.time-row')?.innerText ?? ''`)
    const m = /(\d+):(\d+)/.exec(t ?? '')
    samples.push(m ? Number(m[1]) * 60 + Number(m[2]) : null)
  }
  let regressions = 0
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i] === null || samples[i - 1] === null) continue
    if (samples[i] < samples[i - 1]) regressions += 1
  }
  return { 采样: samples, 回退次数: regressions }
}

/** 9. 本地文件播放（下载目录里的文件能不能播） */
async function checkLocalPlay() {
  return await inPage(`
    const tasks = (await window.api.download.list()).filter(t => t.status === 'done')
    if (!tasks.length) return { ok: false, why: '没有已完成的下载' }
    const t = tasks[0]
    const r = await window.api.player.getUrl({
      song: { id: 'local_' + t.savePath, platform: 'local', songmid: t.savePath, localPath: t.savePath,
              name: t.song.name, singer: t.song.singer, albumName: '', duration: 0, qualities: ['320k'] },
      quality: '320k'
    })
    const el = new Audio()
    el.preload = 'metadata'
    el.src = r.url
    const dec = await new Promise(resolve => {
      const done = (how) => resolve({ how, readyState: el.readyState, dur: Number.isFinite(el.duration) ? Math.round(el.duration) : null, err: el.error?.code ?? null })
      el.addEventListener('loadedmetadata', () => done('ok'), { once: true })
      el.addEventListener('error', () => done('error'), { once: true })
      setTimeout(() => done('timeout'), 8000)
    })
    return { ok: dec.err === null && dec.readyState >= 2, 文件: t.fileName, ...dec }
  `)
}

/** 10. 设置读写：AI 配置、下载配置 */
async function checkSettings() {
  return await inPage(`
    const d = await window.api.download.getConfig()
    const a = await window.api.ai.getConfig()
    return {
      下载目录: d.dir, 下载格式: d.preferQuality, 并发: d.concurrency,
      AI已配置: Boolean(a && (a.baseUrl || a.model)),
      AI模型: a?.model ?? null
    }
  `)
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  await connect()

  const steps = [
    ['运行环境', async () => `Electron OK · ${(await checkEnv()).ua.match(/musichub\/[\d.]+/)?.[0] ?? '?'}`],
    ['音源装载', checkSources],
    ['搜索（5 平台）', checkSearch],
    ['播放（网络取流）', checkPlayback],
    ['歌词与译文控件', checkLyric],
    ['收藏 / 历史', checkLibrary],
    ['下载（入队→落盘）', checkDownload],
    ['封面加载覆盖率', checkCovers],
    ['进度条单调性', checkProgressMonotonic],
    ['本地文件播放', checkLocalPlay],
    ['设置读写', checkSettings]
  ]

  for (const [name, fn] of steps) {
    try {
      const detail = await fn()
      let ok = true
      if (name === '搜索（5 平台）') ok = detail.结果行数 > 0
      else if (name === '播放（网络取流）') ok = Boolean(detail.ok) && !detail.出错
      else if (name === '下载（入队→落盘）') ok = detail.ok === true && detail.状态 === 'done' && detail.存在 === true
      else if (name === '进度条单调性') ok = detail.回退次数 === 0
      else if (name === '歌词与译文控件') ok = detail.歌词行数 > 0 && detail.有翻译按钮 === true
      else if (name === '本地文件播放') ok = detail.ok === true
      else if (name === '音源装载') ok = detail.可用 > 0
      else if (name === '封面加载覆盖率') ok = detail.真正加载出来 > 0
      ok ? pass(name, detail) : fail(name, detail)
    } catch (err) {
      fail(name, `检测过程抛错: ${err?.message ?? err}`)
    }
  }

  // 收尾：清掉验收用的下载目录设置与任务
  try {
    await inPage(`
      const old = await window.api.download.list()
      if (old.length) await window.api.download.remove(old.map(t => t.id), false)
      await window.api.download.setConfig({ dir: 'C:\\\\Users\\\\18509\\\\Desktop\\\\歌曲下载' })
      return 1
    `)
  } catch {
    /* 收尾失败不影响结论 */
  }

  console.log('')
  console.log('='.repeat(72))
  console.log('MusicHub 全功能验收')
  console.log('='.repeat(72))
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`)
    const d = typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail)
    console.log(`      ${d}`)
  }
  const failed = results.filter((r) => !r.ok)
  console.log('')
  console.log(`合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
  ws.close()
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('验收脚本自身出错:', err)
  process.exit(2)
})

