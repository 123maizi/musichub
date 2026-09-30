/**
 * IPC 路由层
 *
 * 主进程能力的唯一出口。渲染层只能通过这里定义的方法访问底层服务，
 * 通道名集中在此，避免两侧字符串写歪导致「调用无响应」。
 */
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'

import type { Lyric, MusicUrlRequest, SearchRequest, Song } from '@shared/types/music'
import type { AiConfig } from '@shared/types/ai'
import type { SavedTranslation } from '@shared/types/ai'
import { AI_PRESETS } from '@shared/types/ai'
import type { DownloadAddRequest, DownloadConfig } from '@shared/types/download'
import type { AppInfo } from '@shared/types/ipc'
import type { SourceManager } from '@main/core/source/manager'
import type { SearchEngine } from '@main/core/search/engine'
import type { MusicResolver } from '@main/core/source/resolver'
import type { DownloadManager } from '@main/core/download/manager'
import type { StreamProxy } from '@main/core/proxy/stream-proxy'
import { probeUrl } from '@main/core/net/http'
import { downloadCoverTo, resolveCover } from '@main/core/cover'
import { detectSourceLang, translateLrcDetailed, translateLrcWithAi } from '@main/core/lyric/translate'
import { testAiConnection } from '@main/core/lyric/ai-translate'

// 通道名唯一定义源在 shared 层，这里引入并原样再导出给外部引用
import { CH, EV } from '@shared/ipc-channels'

export { CH, EV }

export interface IpcContext {
  sources: SourceManager
  search: SearchEngine
  resolver: MusicResolver
  downloads: DownloadManager
  proxy: StreamProxy
  /** 本地音乐库（我的喜欢 / 历史播放 / 歌单） */
  library: import('@main/core/storage/library').LibraryService
  /** AI 歌词翻译配置 */
  ai: import('@main/core/storage/ai-config').AiConfigStore
  /** 已保存的译文（切歌回来、重启后都还在） */
  savedTranslations: import('@main/core/storage/saved-translation').SavedTranslationStore
  /** 音源目录 */
  sourceDir: string
  /** 默认下载目录 */
  downloadDir: string
}

/** 注册全部 IPC 处理器，并把服务的推送事件转发到渲染层 */
export function registerIpc(ctx: IpcContext): () => void {
  const { sources, search, resolver, downloads, proxy, ai, savedTranslations } = ctx

  /* ------------------------------ 音源 ------------------------------ */

  ipcMain.handle(CH.sourceList, () => sources.list())

  ipcMain.handle(CH.sourceImportFiles, (_e, paths: string[]) => sources.importFiles(paths))

  ipcMain.handle(CH.sourceImportDialog, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择音源脚本',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '音源脚本', extensions: ['js', 'mjs', 'cjs', 'txt'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { imported: [], failed: [], skipped: [] }
    }
    return sources.importFiles(result.filePaths)
  })

  ipcMain.handle(CH.sourceImportUrl, (_e, url: string) => sources.importFromUrl(url))

  ipcMain.handle(CH.sourceImportBundled, () => sources.importBundled())

  ipcMain.handle(CH.sourceRemove, (_e, ids: string[]) => sources.remove(ids))

  ipcMain.handle(CH.sourceToggle, (_e, id: string, enabled: boolean) => sources.toggle(id, enabled))

  ipcMain.handle(CH.sourceReload, (_e, id: string) => sources.reload(id))

  ipcMain.handle(CH.sourceRead, (_e, id: string) => sources.readSource(id))

  ipcMain.handle(CH.sourceWrite, (_e, id: string, code: string) => sources.writeSource(id, code))

  ipcMain.handle(CH.sourceOpenDir, async () => {
    await shell.openPath(ctx.sourceDir)
  })

  /* ------------------------------ 搜索 ------------------------------ */

  ipcMain.handle(CH.searchMulti, (_e, req: SearchRequest) => search.search(req))

  ipcMain.handle(CH.searchProviders, () => search.listProviders())

  // 艺人搜索：与歌曲搜索并行的一条独立链路
  ipcMain.handle(CH.searchArtists, (_e, keyword: string, platforms?: string[]) =>
    search.searchArtists(keyword, platforms)
  )

  // 专辑搜索：同样独立
  ipcMain.handle(CH.searchAlbums, (_e, keyword: string, platforms?: string[]) =>
    search.searchAlbums(keyword, platforms)
  )

  /* ------------------------------ 播放 ------------------------------ */

  ipcMain.handle(CH.playGetUrl, (_e, req: MusicUrlRequest) => resolver.resolve(req))

  ipcMain.handle(CH.playGetLyric, (_e, song: Song, sourceIds?: string[]) =>
    resolver.getLyric(song, sourceIds)
  )

  /**
   * 歌词翻译：源语言自动探测，失败原因如实回报，绝不把原文当译文返回。
   *
   * song 是可选的：带上它之后，歌名 / 歌手 / 专辑会一并写进给 AI 的提示词 ——
   * 模型知道自己在翻哪首歌，人名与专有名词会准得多。
   */
  ipcMain.handle(
    CH.playTranslateLyric,
    async (_e, lyric: Lyric, target?: string, song?: Song) => {
    const main = lyric?.lyric || lyric?.lxlyric || ''
    /** 翻成功就顺手存下来：切歌回来还在、重启也在 */
    const remember = (tlyric: string, provider: SavedTranslation['provider'], model?: string): void => {
      if (!song?.id) return
      savedTranslations.save({
        songId: song.id,
        tlyric,
        provider,
        providerName: model,
        edited: false,
        updatedAt: Date.now()
      })
    }

    // 平台已带官方翻译 → 直接用，不必再翻
    if (lyric?.tlyric && lyric.tlyric.trim()) {
      remember(lyric.tlyric, 'official')
      return {
        lyric,
        translated: true,
        lineCount: 0,
        totalCount: 0,
        sourceLang: detectSourceLang(main),
        cached: true,
        provider: 'official' as const,
        error: undefined
      }
    }

    const sourceLang = detectSourceLang(main)
    const cfg = ai.get()

    /**
     * AI 是否可用。
     *
     * 注意关键那一项：**Key 为空时也可能可用** ——
     * 本地 Ollama 这类服务根本不需要 Key。早先这里的判断是「必须有 Key」，
     * 结果本地模型永远走不到 AI 分支，用户会以为功能坏了。
     */
    const preset = AI_PRESETS.find((p) => p.id === cfg.preset)
    const keyReady = Boolean(cfg.apiKey.trim()) || preset?.noKey === true
    const aiReady = cfg.enabled && keyReady && Boolean(cfg.baseUrl.trim()) && Boolean(cfg.model.trim())

    /**
     * 优先走 AI。
     *
     * 顺序是刻意的：AI 译文质量明显更好，而公共接口额度按 IP 算、
     * 翻几首就见底。AI 失败时（额度不足、网络不通、模型答非所问）
     * 按配置决定要不要回落到公共接口 —— 宁可给一个次一点的译文，
     * 也好过让用户点了按钮什么都没发生。
     */
    if (aiReady) {
      try {
        // 把歌名 / 歌手 / 专辑一并交给模型：知道在翻哪首歌，译文会准得多
        const aiResult = await translateLrcWithAi(main, cfg, {
          name: song?.name,
          singer: song?.singer,
          album: song?.albumName
        })
        if (aiResult.result.translated) {
          remember(aiResult.result.lrc, 'ai', aiResult.model)
          return {
            lyric: {
              ...lyric,
              tlyric: aiResult.result.lrc,
              sourceId: `${lyric?.sourceId ?? 'builtin'}+ai`
            },
            translated: true,
            lineCount: aiResult.result.successCount,
            totalCount: aiResult.result.totalCount,
            sourceLang,
            provider: 'ai' as const,
            providerName: aiResult.model,
            error: aiResult.result.error
          }
        }
        /**
         * AI 没能翻动（例如它把原文原样抄了回来、或中文短路）。
         *
         * 这里绝不能静默溜到下面的内置翻译分支 —— 那样用户只会看到
         * 「点完翻译什么都没有」，完全不知道发生了什么。
         * 无论走哪条路，都要带上一句说明。
         */
        const aiReason = aiResult.result.error ?? 'AI 没有产生译文'
        if (!cfg.fallbackToPublic) {
          return {
            lyric: null,
            translated: false,
            lineCount: 0,
            totalCount: aiResult.result.totalCount,
            sourceLang,
            provider: 'ai' as const,
            providerName: aiResult.model,
            error: `AI 没能翻译这首歌：${aiReason}`
          }
        }
        const afterAi = await translateLrcDetailed(main, target)
        if (afterAi.translated) remember(afterAi.lrc, 'public')
        return {
          lyric: afterAi.translated
            ? {
                ...lyric,
                tlyric: afterAi.lrc,
                sourceId: `${lyric?.sourceId ?? 'builtin'}+translated`
              }
            : null,
          translated: afterAi.translated,
          lineCount: afterAi.successCount,
          totalCount: afterAi.totalCount,
          sourceLang,
          provider: 'public' as const,
          cached: afterAi.cached,
          error: afterAi.translated
            ? `AI 没能翻译（${aiReason}），已改用内置翻译`
            : `AI 没能翻译（${aiReason}）；内置翻译也没成功：${afterAi.error ?? '未知原因'}`
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        // AI 挂了：按配置回落到公共接口，并在结果里说明发生了什么
        if (!cfg.fallbackToPublic) {
          return {
            lyric: null,
            translated: false,
            lineCount: 0,
            totalCount: 0,
            sourceLang,
            provider: 'ai' as const,
            error: `AI 翻译失败：${reason}`
          }
        }
        const fallback = await translateLrcDetailed(main, target)
        if (fallback.translated) remember(fallback.lrc, 'public')
        return {
          lyric: fallback.translated
            ? {
                ...lyric,
                tlyric: fallback.lrc,
                sourceId: `${lyric?.sourceId ?? 'builtin'}+translated`
              }
            : null,
          translated: fallback.translated,
          lineCount: fallback.successCount,
          totalCount: fallback.totalCount,
          sourceLang,
          provider: 'public' as const,
          cached: fallback.cached,
          error: fallback.translated
            ? `AI 翻译失败（${reason}），已改用内置翻译`
            : `AI 翻译失败（${reason}）；内置翻译也没成功：${fallback.error ?? '未知原因'}`
        }
      }
    }

    const result = await translateLrcDetailed(main, target)
    if (!result.translated) {
      return {
        lyric: null,
        translated: false,
        lineCount: 0,
        totalCount: result.totalCount,
        sourceLang,
        provider: 'public' as const,
        error: result.error
      }
    }

    remember(result.lrc, 'public')
    return {
      lyric: { ...lyric, tlyric: result.lrc, sourceId: `${lyric?.sourceId ?? 'builtin'}+translated` },
      translated: true,
      lineCount: result.successCount,
      totalCount: result.totalCount,
      sourceLang,
      cached: result.cached,
      provider: 'public' as const,
      error: result.error
    }
  })

  ipcMain.handle(CH.playProbe, (_e, url: string) => probeUrl(url))

  /* ------------------------------ AI 翻译 ------------------------------ */

  ipcMain.handle(CH.aiGetConfig, () => ai.get())

  ipcMain.handle(CH.aiSetConfig, (_e, patch: Partial<AiConfig>) => ai.set(patch))

  // 测试连接：顺带把服务端的模型列表带回来，界面可以直接给用户选
  ipcMain.handle(CH.aiTest, () => testAiConnection(ai.get()))

  /* ------------------------------ 译文存取 ------------------------------ */

  ipcMain.handle(CH.lyricSavedGet, (_e, songId: string) => savedTranslations.get(songId))

  ipcMain.handle(CH.lyricSavedSet, (_e, entry: SavedTranslation) =>
    savedTranslations.save({ ...entry, updatedAt: Date.now() })
  )

  ipcMain.handle(CH.lyricSavedDelete, (_e, songId: string) => {
    savedTranslations.remove(songId)
  })

  // 渲染层发现音源给了试听片段时会调这里：冷却该源 + 清掉这首歌的缓存
  ipcMain.handle(
    CH.playReportBadSource,
    (_e, sourceId: string, song: Song, reason?: string) => {
      resolver.reportBadSource(sourceId, song, reason)
    }
  )

  // 封面补全：平台没给封面时，按「歌名 + 歌手」去封面质量更稳的平台找一张
  ipcMain.handle(CH.coverResolve, (_e, song: Song) => resolveCover(song))

  /**
   * 把封面存到本地。
   *
   * 默认存进下载目录，文件名沿用下载模板（把 {quality} 换成「封面」），
   * 这样封面文件与音频文件在同一处、名字也对得上。
   */
  ipcMain.handle(CH.coverDownload, async (_e, song: Song, dir?: string) => {
    const config = downloads.getConfig()
    const targetDir = dir?.trim() || config.dir
    const template = config.nameTemplate || '{singer} - {name}'
    const baseName = template
      .replace(/\{name\}/gi, song.name ?? '')
      .replace(/\{singer\}/gi, song.singer ?? '')
      .replace(/\{album\}/gi, song.albumName ?? '')
      .replace(/\{quality\}/gi, '封面')
      .replace(/\{platform\}/gi, song.platform ?? '')
      .trim()

    return downloadCoverTo(song, targetDir, baseName || song.name || 'cover')
  })

  /* ------------------------------ 下载 ------------------------------ */

  ipcMain.handle(CH.downloadAdd, (_e, req: DownloadAddRequest) => downloads.add(req))

  ipcMain.handle(CH.downloadList, () => downloads.list())

  ipcMain.handle(CH.downloadAudit, () => downloads.audit())

  ipcMain.handle(CH.downloadPause, (_e, ids: string[]) => downloads.pause(ids))

  ipcMain.handle(CH.downloadResume, (_e, ids: string[]) => downloads.resume(ids))

  ipcMain.handle(CH.downloadRemove, (_e, ids: string[], deleteFile: boolean) =>
    downloads.remove(ids, deleteFile)
  )

  ipcMain.handle(CH.downloadRetry, (_e, ids: string[]) => downloads.retry(ids))

  ipcMain.handle(CH.downloadClear, () => downloads.clearFinished())

  ipcMain.handle(CH.downloadGetConfig, () => downloads.getConfig())

  ipcMain.handle(CH.downloadSetConfig, (_e, patch: Partial<DownloadConfig>) =>
    downloads.setConfig(patch)
  )

  ipcMain.handle(CH.downloadChooseDir, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择下载目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const dir = result.filePaths[0]
    downloads.setConfig({ dir })
    return dir
  })

  ipcMain.handle(CH.downloadOpenFile, async (_e, path: string) => {
    if (!existsSync(path)) throw new Error('文件不存在或已被移动')
    const err = await shell.openPath(path)
    if (err) throw new Error(err)
  })

  ipcMain.handle(CH.downloadShowInFolder, (_e, path: string) => {
    if (!existsSync(path)) throw new Error('文件不存在或已被移动')
    shell.showItemInFolder(path)
  })

  /* ------------------------------ 音乐库 ------------------------------ */

  ipcMain.handle(CH.librarySnapshot, () => ctx.library.snapshot())

  ipcMain.handle(CH.libraryStats, () => ctx.library.stats())

  ipcMain.handle(CH.libraryToggleFavorite, (_e, song: Song) =>
    ctx.library.toggleFavorite(song)
  )

  ipcMain.handle(CH.libraryClearFavorites, () => ctx.library.clearFavorites())

  ipcMain.handle(CH.libraryRecordPlay, (_e, song: Song) => ctx.library.recordPlay(song))

  ipcMain.handle(CH.libraryRemoveHistory, (_e, songIds: string[]) =>
    ctx.library.removeHistory(songIds)
  )

  ipcMain.handle(CH.libraryClearHistory, () => ctx.library.clearHistory())

  ipcMain.handle(
    CH.libraryPlaylist,
    (_e, action: import('@shared/types/library').PlaylistAction) => ctx.library.playlist(action)
  )

  /* ------------------------------ 应用 ------------------------------ */

  ipcMain.handle(CH.appInfo, (): AppInfo => ({
    name: 'MusicHub',
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    platform: process.platform,
    userDataPath: app.getPath('userData'),
    sourceDir: ctx.sourceDir,
    downloadDir: ctx.downloadDir,
    proxyPort: proxy.currentPort
  }))

  ipcMain.handle(CH.appOpenExternal, async (_e, url: string) => {
    // 仅放行 http(s)，避免被当作本地文件协议滥用
    if (!/^https?:\/\//i.test(url)) throw new Error('仅支持打开 http/https 链接')
    await shell.openExternal(url)
  })

  ipcMain.handle(CH.appToggleDevTools, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.webContents.toggleDevTools()
  })

  ipcMain.on(CH.appMinimize, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize()
  })

  ipcMain.on(CH.appMaximize, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.on(CH.appClose, (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })

  /* ------------------------------ 事件转发 ------------------------------ */

  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      try {
        win.webContents.send(channel, payload)
      } catch {
        // 窗口正好在这一瞬被销毁（退出时很常见）：丢掉这一帧即可，不能让它冒泡
        // 成 unhandledRejection 把退出流程搞乱
      }
    }
  }

  // 保存成具名引用：退出时要能精确摘除，而不是 removeAllListeners 一刀切
  const onDownloadProgress = (task: unknown): void => broadcast(EV.downloadProgress, task)
  const onDownloadDone = (task: unknown): void => broadcast(EV.downloadDone, task)
  const onDownloadError = (task: unknown): void => broadcast(EV.downloadError, task)
  const onSourceChanged = (list: unknown): void => broadcast(EV.sourceChanged, list)

  downloads.on('progress', onDownloadProgress)
  downloads.on('done', onDownloadDone)
  downloads.on('error', onDownloadError)
  sources.on('changed', onSourceChanged)

  /**
   * 释放函数：退出时调用。
   *
   * 为什么要显式释放：主进程退出时这些转发闭包会把 downloads / sources
   * 一直引用在 IPC 层，`ipcMain.handle` 注册的通道也留在 Electron 内部表里。
   * 顺手摘干净，退出路径上就没有「谁还引用着谁」的悬念。
   */
  return (): void => {
    downloads.off('progress', onDownloadProgress)
    downloads.off('done', onDownloadDone)
    downloads.off('error', onDownloadError)
    sources.off('changed', onSourceChanged)
    unregisterIpc()
  }
}

/** 释放 IPC 监听（窗口重建 / 退出时用） */
export function unregisterIpc(): void {
  for (const channel of Object.values(CH)) {
    // handle 通道与 on 通道都要清：只清 handle 会留下 on 的监听
    ipcMain.removeHandler(channel)
    ipcMain.removeAllListeners(channel)
  }
}
