/**
 * 主进程入口
 *
 * 装配顺序（有依赖关系，不能随意调换）：
 *   StreamProxy  → 必须先起来，取流结果要经过它包装
 *   SourceManager → 装载音源，提供取流能力
 *   SearchEngine → 依赖音源能力来校正可用音质
 *   MusicResolver → 依赖音源 + 代理
 *   DownloadManager → 依赖取流器
 */
import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { APP_CONST, DEFAULT_NAME_TEMPLATE } from '@shared/constants'
import type { DownloadConfig, DownloadTask } from '@shared/types/download'

import { SourceManager } from './core/source/manager'
import { SearchEngine } from './core/search/engine'
import { MusicResolver } from './core/source/resolver'
import { StreamProxy } from './core/proxy/stream-proxy'
import { DownloadManager } from './core/download/manager'
import { JsonStore } from './core/storage/store'
import { LibraryService } from './core/storage/library'
import { registerIpc } from './ipc'
import { createWindow } from './window'

/**
 * 暴露给音源脚本的宿主版本号。
 * 注意：这里必须是「洛雪版本量级」而不是本应用版本 ——
 * 音源脚本会拿它做版本判断（如 v2.6.0 以上的源会拒绝低版本宿主）。
 */
const HOST_VERSION_FOR_SOURCES = '2.7.0'

type LogLevel = 'info' | 'warn' | 'error'

/** 统一日志出口：控制台 + 文件 */
function createLogger(logFile: string) {
  return (level: LogLevel, scope: string, message: string): void => {
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${scope}] ${message}`
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
    try {
      appendFileSync(logFile, `${line}\n`, 'utf8')
    } catch {
      /* 日志写不进去不能影响主流程 */
    }
  }
}

/**
 * 首次运行：把随应用分发的内置音源导入到用户目录。
 *
 * 只有确实导入了东西才写标记 —— 否则「路径写错导致导入 0 个」会被标记成已完成，
 * 之后永远不再重试（这个坑已经踩过一次）。
 */
async function importBundledIfNeeded(
  sources: SourceManager,
  markerFile: string,
  log: (level: LogLevel, scope: string, message: string) => void
): Promise<void> {
  try {
    if (existsSync(markerFile)) return

    const result = await sources.importBundled()

    if (result.imported.length === 0 && result.failed.length === 0) {
      log('warn', 'app', '未发现内置音源（请确认 resources/sources 存在），本次跳过导入')
      return
    }

    mkdirSync(join(markerFile, '..'), { recursive: true })
    appendFileSync(
      markerFile,
      `bundled imported at ${new Date().toISOString()} (${result.imported.length} ok, ${result.failed.length} failed)\n`,
      'utf8'
    )
    log(
      'info',
      'app',
      `内置音源导入完成: 成功 ${result.imported.length}，失败 ${result.failed.length}`
    )
  } catch (err) {
    log('warn', 'app', `内置音源导入异常: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData')
  const log = createLogger(join(userData, 'musichub.log'))

  log('info', 'app', `MusicHub 启动  electron=${process.versions.electron} node=${process.versions.node}`)

  /* --------------------------- 1. 本地流代理 --------------------------- */
  const proxy = new StreamProxy()
  const port = await proxy.start(APP_CONST.proxyPort)
  log('info', 'proxy', `本地流代理已启动 http://127.0.0.1:${port}`)

  /* --------------------------- 2. 配置存储 --------------------------- */
  const defaultDownloadDir = join(app.getPath('music'), 'MusicHub')
  if (!existsSync(defaultDownloadDir)) {
    try {
      mkdirSync(defaultDownloadDir, { recursive: true })
    } catch {
      /* 取不到系统音乐目录时退回用户数据目录 */
    }
  }

  const configStore = new JsonStore<DownloadConfig>(join(userData, 'download-config.json'), {
    dir: defaultDownloadDir,
    nameTemplate: DEFAULT_NAME_TEMPLATE,
    conflict: 'rename',
    concurrency: 2,
    retry: 2,
    writeTag: true,
    downloadCover: true,
    downloadLyric: true,
    preferQuality: '320k'
  })

  /**
   * 把下载目录登记为「允许本地播放」的白名单。
   * 代理只放行白名单内的路径 —— 它是本机端口，不能变成任意文件读取接口。
   */
  proxy.setLocalRoots([configStore.get().dir, defaultDownloadDir])
  // 用户改了下载目录也要跟着更新，否则换目录后新下的歌又播不了
  configStore.onChange((next) => {
    proxy.setLocalRoots([next.dir, defaultDownloadDir])
  })

  /* --------------------------- 3. 核心服务 --------------------------- */
  const sourceDir = join(userData, APP_CONST.sourceDirName)
  /**
   * 内置音源目录解析：
   * 打包后位于 resources/sources；
   * 开发态注意 process.resourcesPath 指向的是 Electron 自身的 resources 目录，
   * 必须改用 app.getAppPath()（项目根）才是对的。
   */
  const bundledDir = app.isPackaged
    ? join(process.resourcesPath, 'sources')
    : join(app.getAppPath(), 'resources', 'sources')

  const sources = new SourceManager({
    sourceDir,
    bundledDir,
    stateFile: join(userData, 'source-state.json'),
    version: HOST_VERSION_FOR_SOURCES,
    onLog: log
  })

  const search = new SearchEngine({ sources, onLog: log })
  const resolver = new MusicResolver({ sources, proxy, onLog: log })
  const downloads = new DownloadManager({
    resolver,
    configStore,
    /**
     * 下载记录要落盘。
     * 之前只存在内存里，重启后列表就是空的 —— 用户下过的歌看不到也播不了。
     */
    historyStore: new JsonStore<{ tasks: DownloadTask[] }>(
      join(userData, 'download-tasks.json'),
      { tasks: [] },
      { debounceMs: 400 }
    ),
    onLog: log
  })
  // 音乐库：喜欢 / 历史 / 歌单统一落在用户数据目录
  const library = new LibraryService(join(userData, 'library.json'))

  /* --------------------------- 4. IPC --------------------------- */
  registerIpc({
    sources,
    search,
    resolver,
    downloads,
    library,
    proxy,
    sourceDir,
    downloadDir: configStore.get().dir
  })

  /* --------------------------- 5. 开窗 --------------------------- */
  // 先开窗再装载音源：几十个音源脚本要逐个进沙箱执行，
  // 放在开窗前会把启动拖成几十秒的空白等待。
  createWindow()

  /* --------------------------- 6. 后台装载音源 --------------------------- */
  // 装载进度由 SourceManager 的 changed 事件自动推送到界面，无需在此手动通知
  void (async () => {
    await sources.init()
    await importBundledIfNeeded(sources, join(userData, '.bundled-imported'), log)
    const ready = sources.list().filter((s) => s.status === 'ready')
    log('info', 'app', `音源装载完成: ${ready.length}/${sources.list().length} 可用`)
  })()

  /* --------------------------- 退出清理 --------------------------- */
  app.on('before-quit', () => {
    downloads.dispose()
    sources.dispose()
    library.dispose()
    void proxy.stop()
  })
}

/* ------------------------------------------------------------------ *
 * 应用生命周期
 * ------------------------------------------------------------------ */

// 单实例：重复启动时聚焦已有窗口，避免多个进程抢同一个音源目录
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.musichub.app')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    await bootstrap()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

/**
 * 全局兜底。
 * 音源脚本来自第三方，即使沙箱已经做了捕获，仍可能有异步异常逃逸到事件循环。
 * 这类异常绝不能拖垮整个应用，因此统一记录到日志并放行。
 */
function logFatal(kind: string, err: unknown): void {
  const message =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err)
  const line = `[${new Date().toISOString()}] [FATAL] [${kind}] ${message}\n`
  try {
    appendFileSync(join(app.getPath('userData'), 'musichub.log'), line, 'utf8')
  } catch {
    /* 日志写不进去也不能影响主流程 */
  }
  console.error(line.trim())
}

process.on('uncaughtException', (err) => logFatal('uncaughtException', err))
process.on('unhandledRejection', (reason) => logFatal('unhandledRejection', reason))
