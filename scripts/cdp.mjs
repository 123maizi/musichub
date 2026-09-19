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

/* 从文件读探针代码：node scripts/cdp.mjs evalfile <路径>
   多行脚本走命令行会被 shell 的引号规则折腾，放文件里干净得多 */
if (cmd === 'evalfile') {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(process.argv[3], 'utf8')
  const value = await evaluate(cdp, `(async () => { ${src} })()`)
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

/* ---------------------------------------------------------------- */
if (cmd === 'jump') {
  console.log('\n[1] 搜索「See Me Now Ye」，检查酷我的转义有没有解干净')
  await evaluate(cdp, `window.location.hash = '#/search'`)
  await sleep(1200)
  await evaluate(cdp, `document.querySelector('.search-box input').focus()`)
  await cdp.send('Input.insertText', { text: 'See Me Now Ye' })
  await sleep(300)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })

  let rows = 0
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    rows = await evaluate(cdp, `document.querySelectorAll('.results .row').length`)
    if (rows > 0) break
  }
  console.log(`    结果行数: ${rows}`)
  if (rows === 0) throw new Error('搜索没结果')

  // 直接在数据层看：不经界面，免得被渲染层的字符处理糊弄
  const singers = await evaluate(
    cdp,
    `(async () => {
       const r = await window.api.search.search({ keyword: 'See Me Now Ye', limit: 30 })
       const all = r.platforms.flatMap(p => p.songs)
       const bad = all.filter(s => String(s.singer).includes('\\\\u0026'))
       const multi = all.filter(s => s.platform === 'kw' && String(s.singer).includes('&'))
       return JSON.stringify({
         total: all.length,
         stillEscaped: bad.length,
         multiArtist: multi.slice(0, 3).map(s => s.singer)
       })
     })()`
  )
  const s = JSON.parse(singers)
  console.log(`    结果总数: ${s.total}`)
  console.log(`    仍含 \\u0026 的: ${s.stillEscaped}  ${s.stillEscaped === 0 ? '✓' : '✗ 转义没解干净'}`)
  console.log(`    多歌手示例:`)
  for (const x of s.multiArtist) console.log(`      ${x}`)

  console.log('\n[2] 播放一条酷我结果（用来测跳转）')
  // 先滚进可视区再量坐标：列表很长，第 40 多行的 rect 可能已经在窗口外，
  // 那样点下去是空的，测试会误判成「功能没生效」
  const scrolled = await evaluate(
    cdp,
    `(() => {
       const rows = [...document.querySelectorAll('.results .row')]
       const row = rows.find(r => /\\bKW\\b/.test(r.innerText)) || rows[0]
       if (!row) return null
       row.scrollIntoView({ block: 'center' })
       return row.innerText.replace(/\\s+/g, ' ').slice(0, 70)
     })()`
  )
  if (!scrolled) throw new Error('找不到可播放的行')
  console.log(`    选中: ${scrolled}`)
  await sleep(900)

  const box = await evaluate(
    cdp,
    `(() => {
       const rows = [...document.querySelectorAll('.results .row')]
       const row = rows.find(r => /\\bKW\\b/.test(r.innerText)) || rows[0]
       const btn = row.querySelector('.col-actions button[title="播放"]')
       if (!btn) return null
       const b = btn.getBoundingClientRect()
       return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2, y0: b.top, inView: b.top > 0 && b.bottom < innerHeight })
     })()`
  )
  if (!box) throw new Error('找不到播放按钮')
  const b = JSON.parse(box)
  if (!b.inView) throw new Error(`播放按钮仍不在可视区（y=${Math.round(b.y0)}），点不到`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 })
  }
  await sleep(7000)

  console.log('\n[3] 进正在播放页，确认歌手/专辑可点')
  await evaluate(cdp, `window.location.hash = '#/now-playing'`)
  await sleep(2500)
  const jumps = await evaluate(
    cdp,
    `(() => {
       const items = [...document.querySelectorAll('.jump')].map(e => e.innerText.trim())
       const cover = document.querySelector('.cover img')?.src ?? null
       return JSON.stringify({ count: items.length, items, cover })
     })()`
  )
  const j = JSON.parse(jumps)
  console.log(`    可点元素 ${j.count} 个: ${JSON.stringify(j.items)}`)
  console.log(`    封面地址: ${j.cover ? j.cover.slice(0, 110) : '（无图，走了补图或占位）'}`)
  if (j.count < 2) throw new Error('歌手/专辑没有都可点')

  console.log('\n[4] 点歌手 → 艺人页')
  const ab = await evaluate(
    cdp,
    `(() => { const e = document.querySelectorAll('.jump')[0]; const r = e.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,text:e.innerText.trim()}) })()`
  )
  const ap = JSON.parse(ab)
  console.log(`    点击「${ap.text}」`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: ap.x, y: ap.y, button: 'left', clickCount: 1 })
  }
  let artistOk = '{}'
  for (let i = 0; i < 20; i += 1) {
    await sleep(1000)
    const snap = JSON.parse(
      await evaluate(
        cdp,
        `JSON.stringify({ hash: location.hash, heading: document.querySelector('h1')?.innerText?.trim() ?? null, songs: document.querySelectorAll('.row').length })`
      )
    )
    if (snap.hash === '#/artist') {
      // 已经到页了就再等曲目加载出来，否则报一个假的「0 首」
      if (snap.songs > 0) {
        artistOk = JSON.stringify(snap)
        break
      }
      artistOk = JSON.stringify(snap)
    }
  }
  const ar = JSON.parse(artistOk)
  console.log(`    ${artistOk}`)
  if (ar.hash !== '#/artist') throw new Error('点歌手没有跳到艺人页')
  console.log(`    跳到艺人页: ✓  页面标题「${ar.heading}」  曲目 ${ar.songs} 首`)

  console.log('\n[5] 回去点专辑 → 专辑页')
  await evaluate(cdp, `window.location.hash = '#/now-playing'`)
  await sleep(2000)
  const lb = await evaluate(
    cdp,
    `(() => { const e = document.querySelectorAll('.jump')[1]; if(!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,text:e.innerText.trim()}) })()`
  )
  if (!lb) throw new Error('专辑不可点')
  const lp = JSON.parse(lb)
  console.log(`    点击「${lp.text}」`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: lp.x, y: lp.y, button: 'left', clickCount: 1 })
  }
  let albumOk = '{}'
  for (let i = 0; i < 20; i += 1) {
    await sleep(1000)
    const snap = JSON.parse(
      await evaluate(
        cdp,
        `JSON.stringify({ hash: location.hash, heading: document.querySelector('h1')?.innerText?.trim() ?? null, songs: document.querySelectorAll('.row').length })`
      )
    )
    if (snap.hash.startsWith('#/album')) {
      if (snap.songs > 0) {
        albumOk = JSON.stringify(snap)
        break
      }
      albumOk = JSON.stringify(snap)
    }
  }
  const al = JSON.parse(albumOk)
  console.log(`    ${albumOk}`)
  if (!al.hash.startsWith('#/album')) throw new Error('点专辑没有跳到专辑页')
  console.log(`    跳到专辑页: ✓  标题「${al.heading}」  曲目 ${al.songs} 首`)
}

cdp.close()
