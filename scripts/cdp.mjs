/**
 * 通过 Chrome DevTools Protocol 驱动真实运行的 MusicHub 渲染进程。
 *
 * 为什么不用截图点按：这个 Electron 窗口是 GPU 合成的，
 * 截图经常只能拿到一帧全黑，视觉定位完全不可靠。
 * CDP 直接跟渲染进程对话 —— 走的是真实 IPC 边界，结果确定可判。
 *
 * 用法： node .tmp/cdp.mjs <命令>
 *   ipc      仅验证 IPC 往返（翻译）
 *   ui       搜索 → 播放 → 打开正在播放 → 点翻译按钮 → 读译文
 */

const PORT = 9222

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
    ws.addEventListener('error', (e) => reject(new Error('WS 连接失败')))
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

/** 在页面里执行一段表达式，返回值按值序列化 */
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const cmd = process.argv[2] ?? 'ipc'

const page = await pickPage()
const cdp = await connect(page.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')

/* 通用探针：node scripts/cdp.mjs eval "<表达式>" */
if (cmd === 'eval') {
  const value = await evaluate(cdp, process.argv[3] ?? '1')
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
  cdp.close()
  process.exit(0)
}

console.log(`已连接渲染进程：${page.title}`)

/* ---------------------------------------------------------------- */
if (cmd === 'ipc') {
  console.log('\n[IPC] window.api.player.translateLyric —— 真实跨进程往返')
  const probe = await evaluate(
    cdp,
    `(async () => {
       const src = "[00:00.00]Imagine there's no heaven\\n[00:05.00]It's easy if you try\\n[00:11.00]No hell below us"
       const r = await window.api.player.translateLyric({ lyric: src, sourceId: 'cdp' }, 'zh-CN')
       return JSON.stringify({
         hasApi: typeof window.api?.player?.translateLyric,
         translated: r?.translated,
         lineCount: r?.lineCount,
         totalCount: r?.totalCount,
         sourceLang: r?.sourceLang,
         error: r?.error ?? null,
         tlyric: r?.lyric?.tlyric ?? null
       })
     })()`
  )
  const r = JSON.parse(probe)
  console.log(`    API 存在: ${r.hasApi}`)
  console.log(`    translated: ${r.translated}`)
  console.log(`    翻译行数: ${r.lineCount}/${r.totalCount}   源语言: ${r.sourceLang}`)
  if (r.error) console.log(`    error: ${r.error}`)
  console.log(`    译文 LRC:\n${r.tlyric}`)
}

/* ---------------------------------------------------------------- */
if (cmd === 'ui') {
  console.log('\n[1] 搜索 Imagine')
  await evaluate(cdp, `document.querySelector('.search-box input').focus()`)
  await cdp.send('Input.insertText', { text: 'Imagine' })
  await sleep(300)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })

  let rows = 0
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    // 结果是 div 表格（.results .body .row），不是原生 <table>
    rows = await evaluate(cdp, `document.querySelectorAll('.results .row').length`)
    if (rows > 0) break
  }
  console.log(`    结果行数: ${rows}`)
  if (rows === 0) throw new Error('搜索没有返回结果，无法继续')

  const first = await evaluate(
    cdp,
    `(() => {
       const row = document.querySelector('.results .row')
       return row ? row.innerText.replace(/\\s+/g, ' ').slice(0, 90) : null
     })()`
  )
  console.log(`    第一条: ${first}`)

  console.log('\n[2] 播放第一条（点行内播放键）')
  const box = await evaluate(
    cdp,
    `(() => {
       const btn = document.querySelector('.results .row .col-actions button[title="播放"]')
       if (!btn) return null
       const r = btn.getBoundingClientRect()
       return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
     })()`
  )
  if (!box) throw new Error('找不到播放按钮')
  const { x, y } = JSON.parse(box)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  }

  console.log('    等待开始播放…')
  let playing = false
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    playing = await evaluate(
      cdp,
      `(() => { const a = document.querySelector('audio'); return !!(a && !a.paused && a.currentTime > 0) })()`
    )
    if (playing) break
  }
  console.log(`    正在播放: ${playing}`)

  console.log('\n[3] 跳转到正在播放页')
  await evaluate(cdp, `window.location.hash = '#/now-playing'`)
  await sleep(2500)

  const dom = await evaluate(
    cdp,
    `(() => {
       const btn = document.querySelector('.translate-btn')
       const lines = document.querySelectorAll('.lyric-line').length
       return JSON.stringify({
         hasButton: !!btn,
         buttonText: btn ? btn.innerText.trim() : null,
         lyricLines: lines
       })
     })()`
  )
  console.log(`    ${dom}`)
  const d = JSON.parse(dom)
  if (!d.hasButton) throw new Error('翻译按钮没渲染出来')
  if (d.lyricLines === 0) throw new Error('没有歌词行，翻译按钮的展示条件不成立')

  console.log('\n[4] 点击翻译按钮')
  const btnBox = await evaluate(
    cdp,
    `(() => {
       const b = document.querySelector('.translate-btn')
       const r = b.getBoundingClientRect()
       return JSON.stringify({ x: r.left + r.width/2, y: r.top + r.height/2, label: b.innerText.trim() })
     })()`
  )
  const bb = JSON.parse(btnBox)
  console.log(`    按钮: "${bb.label}" @ ${Math.round(bb.x)},${Math.round(bb.y)}`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: bb.x, y: bb.y, button: 'left', clickCount: 1 })
  }

  console.log('    等待翻译完成…')
  let result = null
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000)
    const raw = await evaluate(
      cdp,
      `(() => {
         const btn = document.querySelector('.translate-btn')
         const trans = [...document.querySelectorAll('.lyric-trans')].map(e => e.innerText.trim())
         return JSON.stringify({
           label: btn ? btn.innerText.trim() : null,
           note: document.querySelector('.translate-note')?.innerText.trim() ?? null,
           count: trans.length,
           sample: trans.slice(0, 6)
         })
       })()`
    )
    result = JSON.parse(raw)
    if (result.count > 0) break
  }

  console.log(`\n[5] 结果`)
  console.log(`    按钮文案: ${result.label}`)
  console.log(`    译文行数: ${result.count}`)
  if (result.note) console.log(`    提示: ${result.note}`)
  if (result.count > 0) {
    console.log('    译文样例:')
    for (const t of result.sample) console.log(`      ${t}`)
  } else {
    console.log('    ✗ 没有出现任何译文行')
  }
}

cdp.close()
