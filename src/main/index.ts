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
import { AiConfigStore, type StoredAiConfig } from './core/storage/ai-config'
import { SavedTranslationStore } from './core/storage/saved-translation'
import { PreferencesStore } from './core/storage/preferences'
import { DEFAULT_AI_CONFIG } from '@shared/types/ai'
import type { SavedTranslation } from '@shared/types/ai'
import { registerIpc } from './ipc'
import { createWindow } from './window'

/**
 * 暴露给音源脚本的宿主版本号。
 * 注意：这里必须是「洛雪版本量级」而不是本应用版本 ——
 * 音源脚本会拿它做版本判断（如 v2.6.0 以上的源会拒绝低版本宿主）。
 */
const HOST_VERSION_FOR_SOURCES = '2.7.0'

type LogLevel = 'info' | 'warn' | 'error'

/** 带 flush 的日志出口：退出前必须把缓冲写下去 */
interface AppLogger {
  (level: LogLevel, scope: string, message: string): void
  /** 立刻把缓冲落盘 */
  flush(): void
}

/**
 * 退出路径上要用的日志 flush（logFatal 走的是另一条路，但也想保序）。
 * 放在模块级是为了让 logFatal 在 bootstrap 之外也能拿到。
 */
let flushLogFile: (() => void) | null = null

/**
 * 统一日志出口：控制台 + 文件。
 *
 * 文件写入改成「攒一批再一次 appendFileSync」，而不是每行一次：
 * appendFileSync 是同步阻塞主线程的，音源装载阶段一次能刷出几十行日志，
 * 逐行写等于把主线程按在磁盘上几十次。改成 250ms 合并写之后，
 * 日志能力一点没少（同一份文件、同样的行、同样的格式），同步写盘次数
 * 从「每行一次」降到「每批一次」。
 */
function createLogger(logFile: string): AppLogger {
  let pending: string[] = []
  let timer: NodeJS.Timeout | null = null

  const writeNow = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pending.length === 0) return
    const chunk = pending.join('')
    pending = []
    try {
      appendFileSync(logFile, chunk, 'utf8')
    } catch {
      /* 日志写不进去不能影响主流程 */
    }
  }

  const schedule = (): void => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      writeNow()
    }, 250)
    // 纯写盘任务，不该吊住事件循环：退出时 flush() 会保证不丢
    timer.unref?.()
  }

  const logger = ((level: LogLevel, scope: string, message: string): void => {
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${scope}] ${message}`
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)

    pending.push(`${line}\n`)
    // 攒够一批就立刻写，避免长时间挂着一大块内存；否则等防抖
    if (pending.length >= 64) writeNow()
    else schedule()
  }) as AppLogger

  logger.flush = writeNow
  return logger
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
  flushLogFile = () => log.flush()

  log('info', 'app', `MusicHub 启动  electron=${process.versions.electron} node=${process.versions.node}`)

  /** 退出中：所有后台任务看到它就收敛，不再起新活 */
  let shuttingDown = false

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
   * 把「允许本地播放」的目录登记给代理。
   * 代理只放行白名单内的路径 —— 它是本机端口，不能变成任意文件读取接口。
   *
   * 白名单必须是动态的：[当前下载目录, 默认目录, 下载记录里出现过的每个目录]。
   * 只认当前下载目录的话，用户改一次下载目录，老目录里已经下好的歌
   * 会被 403 全部挡掉 —— 文件在磁盘上、任务写着已完成，点播放却没声音。
   */
  proxy.setLocalRoots([configStore.get().dir, defaultDownloadDir])

  /**
   * AI 翻译配置。
   * API Key 交给 AiConfigStore 用系统凭据（Windows 上是 DPAPI）加密后再落盘，
   * 明文只留在内存里 —— 配置文件被拷走也解不开。
   */
  const aiStore = new AiConfigStore(
    new JsonStore<StoredAiConfig>(join(userData, 'ai-config.json'), {
      ...DEFAULT_AI_CONFIG,
      apiKey: undefined
    } as unknown as StoredAiConfig)
  )

  /**
   * 已保存的译文。
   * 单独一层：切歌回来、重启应用都还在；用户手工改过的也不会被自动翻译覆盖。
   */
  const savedTranslations = new SavedTranslationStore(
    new JsonStore<{ items: Record<string, SavedTranslation> }>(
      join(userData, 'lyric-saved.json'),
      { items: {} }
    )
  )

  /**
   * 界面偏好（搜索页空态来源 + 搜索历史）。
   * 单独一份文件：这是「界面看起来怎样」，与下载配置、AI 配置都不该混在一起。
   */
  const prefs = new PreferencesStore(join(userData, 'ui-prefs.json'))

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
     *
     * pretty: false —— 这份文件是纯机器数据（任务 + 完整歌曲对象，可能上百 KB），
     * 缩进换行只为好看却让体积和 stringify 开销都翻倍；用户不会去读它。
     * 落盘格式仍旧是标准 JSON，读写逻辑完全不变。
     */
    historyStore: new JsonStore<{ tasks: DownloadTask[] }>(
      join(userData, 'download-tasks.json'),
      { tasks: [] },
      { debounceMs: 400, pretty: false }
    ),
    onLog: log
  })

  /**
   * 本地播放白名单改成动态计算。
   *
   * 从前的白名单只有 [当前下载目录, 默认目录]，而且是配置变化时才更新。
   * 后果：用户改一次下载目录，老目录里已经下好的歌全部被代理 403 挡掉 ——
   * 文件就在磁盘上、任务也写着已完成，点播放却什么都听不到。
   * 现在把「下载记录里出现过的每个目录」也算进去，换目录不再牵连老歌。
   */
  proxy.setLocalRootsProvider(() => [
    configStore.get().dir,
    defaultDownloadDir,
    ...downloads.listDirs()
  ])

  // 音乐库：喜欢 / 历史 / 歌单统一落在用户数据目录
  const library = new LibraryService(join(userData, 'library.json'))

  /* --------------------------- 4. IPC --------------------------- */
  const disposeIpc = registerIpc({
    sources,
    search,
    resolver,
    downloads,
    library,
    proxy,
    ai: aiStore,
    savedTranslations,
    prefs,
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
    // 退出中就别再导入内置音源了：每个脚本都要白等一轮握手超时
    if (shuttingDown) return
    await importBundledIfNeeded(sources, join(userData, '.bundled-imported'), log)
    if (shuttingDown) return
    const ready = sources.list().filter((s) => s.status === 'ready')
    log('info', 'app', `音源装载完成: ${ready.length}/${sources.list().length} 可用`)
  })()

  /* --------------------------- 退出清理 --------------------------- */
  /**
   * 退出顺序（每一步都有理由）：
   *  1. 先摘 IPC 转发 —— 窗口正在销毁，此刻继续广播只会撞上已销毁的 webContents
   *  2. 再停服务 —— 下载 abort（关掉 .part 写句柄）、音源沙箱 dispose
   *     （这一步才是「清掉第三方脚本 setInterval」的地方）、歌单/译文/任务落盘
   *  3. 最后**等**代理真正关闭 —— proxy.stop() 是异步的。原来 `void proxy.stop()`
   *     没人等它，进程可能在 HTTP server 关掉之前就退了，端口与句柄只能留给
   *     系统回收；现在换成 before-quit + preventDefault + 清理完成后 app.exit()。
   *
   * 全程 1200ms 硬超时兜底：清理再慢也绝不卡住退出。
   */
  let shutdownStarted = false
  app.on('before-quit', (event) => {
    // 清理没走完之前，任何一次 quit 都要拦下来 —— 否则第二次 quit
    // （用户连点两次关闭、或系统会话结束）会绕开清理直接退出。
    // 注意 app.exit() 不会再触发 before-quit，所以这里不必担心死循环。
    if (shutdownStarted) {
      event.preventDefault()
      return
    }
    shutdownStarted = true
    shuttingDown = true
    event.preventDefault()

    const steps: Promise<unknown>[] = []
    try {
      disposeIpc()
      downloads.dispose()
      sources.dispose()
      library.dispose()
      // 这两个 store 原先定义了 flush 却没人调用：刚保存的译文 / 刚改的 AI 配置
      // 若正好落在 300ms 防抖窗口内退出就会丢，现在补上
      aiStore.flush()
      savedTranslations.flush()
      // 搜索历史/界面偏好也走防抖：退出前必须落盘，否则刚搜的词会丢
      prefs.dispose()
      search.dispose()
      steps.push(proxy.stop())
      log('info', 'app', '退出清理已发起')
    } catch (err) {
      log('warn', 'app', `退出清理异常: ${err instanceof Error ? err.message : String(err)}`)
    }
    log.flush()

    let guard: NodeJS.Timeout | null = null
    const timeout = new Promise<void>((resolve) => {
      guard = setTimeout(resolve, 1200)
    })
    void Promise.race([Promise.allSettled(steps), timeout]).finally(() => {
      if (guard) clearTimeout(guard)
      log('info', 'app', '退出清理完成，进程退出')
      log.flush()
      // 用 exit 而不是 quit：quit 会再次触发 before-quit，绕回本函数
      app.exit(0)
    })
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
    // 先把缓冲里的日志写下去，保证崩溃现场在文件里的顺序是对的
    flushLogFile?.()
  } catch {
    /* 缓冲写失败不影响下面这条 */
  }
  try {
    appendFileSync(join(app.getPath('userData'), 'musichub.log'), line, 'utf8')
  } catch {
    /* 日志写不进去也不能影响主流程 */
  }
  console.error(line.trim())
}

process.on('uncaughtException', (err) => logFatal('uncaughtException', err))
process.on('unhandledRejection', (reason) => logFatal('unhandledRejection', reason))
