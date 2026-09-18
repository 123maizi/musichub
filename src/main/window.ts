/**
 * 窗口管理
 */
import { BrowserWindow, app, shell } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    autoHideMenuBar: true,
    title: 'MusicHub',
    // 深色底，避免加载瞬间白屏闪一下
    backgroundColor: '#0b0b0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 渲染层不需要 Node，保持默认隔离
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  /**
   * 把渲染层的 console 与加载失败转发到主进程日志。
   * 渲染层出问题时（CSP 拦截、脚本报错、资源 404）这是唯一能看到原因的地方。
   */
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const label = ['debug', 'info', 'warn', 'error'][level] ?? String(level)
    const file = sourceId ? `${sourceId.split(/[\\/]/).pop()}:${line}` : ''
    console.log(`[renderer:${label}] ${message}  ${file}`)
  })

  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[renderer] 加载失败 code=${code} ${description} url=${url}`)
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer] 渲染进程退出: ${details.reason}`)
  })

  // 站外链接一律交给系统浏览器，不在应用内开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  /**
   * 链路自检（仅当 MUSICHUB_SELFTEST=1 时启用）。
   *
   * 为什么需要它：渲染层 ↔ 主进程的 IPC 对「不可结构化克隆的对象」非常敏感
   * （Vue 的响应式 Proxy 就是典型受害者），而一旦踩中，界面只会给一句笼统错误，
   * 无从定位。这里直接在渲染层里跑一遍真实调用链，把结果打进主进程日志，
   * 排障时不必靠手点界面。
   */
  if (process.env.MUSICHUB_SELFTEST === '1') {
    win.webContents.once('did-finish-load', () => {
      void (async () => {
        // Windows 下 GUI 进程的 stdout 拿不到，自检结果必须落到日志文件才看得到
        const report = (text: string): void => {
          console.log(text)
          try {
            appendFileSync(
              join(app.getPath('userData'), 'musichub.log'),
              `[${new Date().toISOString()}] [SELFTEST] ${text}\n`,
              'utf8'
            )
          } catch {
            /* 日志写不进去就算了 */
          }
        }
        try {
          const result = await win.webContents.executeJavaScript(SELFTEST_SCRIPT)
          report(JSON.stringify(result))
        } catch (err) {
          report(`执行失败: ${err instanceof Error ? err.message : String(err)}`)
        }
      })()
    })
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/**
 * 自检脚本：在渲染层里执行，走的是与真实播放完全相同的 window.api 通道。
 * 关键在于它刻意用 Proxy 包了一层歌曲对象 —— 那正是 Pinia 响应式对象的形态，
 * 也是「An object could not be cloned」的触发条件。
 */
const SELFTEST_SCRIPT = `
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  // 音源是后台装载的，取流前需要等它就绪
  await wait(26000)
  try {
    const res = await window.api.search.search({ keyword: '晴天', limit: 5 })
    const group = res.platforms.find((p) => p.songs && p.songs.length > 0)
    if (!group) return { step: 'search', ok: false, reason: '搜索没有返回任何结果' }

    const plain = group.songs[0]

    // A 组：直接把响应式代理送过去 —— 应当复现 "could not be cloned"
    let proxyDirect = '未测试'
    try {
      await window.api.player.getUrl({ song: new Proxy(plain, {}), quality: '320k' })
      proxyDirect = '意外成功'
    } catch (err) {
      proxyDirect = (err && err.message) ? err.message : String(err)
    }

    // B 组：解包成纯数据 —— 这正是修复后 store 走的路径
    const unwrapped = JSON.parse(JSON.stringify(plain))
    const url = await window.api.player.getUrl({ song: unwrapped, quality: '320k' })

    return {
      step: 'play',
      ok: true,
      song: plain.name,
      platform: plain.platform,
      proxyDirect,
      source: url.sourceName,
      quality: url.quality,
      proxied: url.proxied,
      attempts: (url.attempts || []).length,
      urlHead: String(url.url).slice(0, 60),
      // 原唱优先排序的实际效果：看每个平台前 4 名是谁
      ranking: res.platforms
        .filter((p) => p.songs && p.songs.length > 0)
        .map((p) =>
          p.platform + ' → ' +
          p.songs.slice(0, 4).map((s) => s.name + '「' + s.singer + '」').join('  |  ')
        )
    }
  } catch (err) {
    return { step: 'error', ok: false, reason: (err && err.message) ? err.message : String(err) }
  }
})()
`
