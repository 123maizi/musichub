/**
 * IPC 路由层
 *
 * 主进程能力的唯一出口。渲染层只能通过这里定义的方法访问底层服务，
 * 通道名集中在此，避免两侧字符串写歪导致「调用无响应」。
 */
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'

import type { MusicUrlRequest, SearchRequest, Song } from '@shared/types/music'
import type { DownloadAddRequest, DownloadConfig } from '@shared/types/download'
import type { AppInfo } from '@shared/types/ipc'
import type { SourceManager } from '@main/core/source/manager'
import type { SearchEngine } from '@main/core/search/engine'
import type { MusicResolver } from '@main/core/source/resolver'
import type { DownloadManager } from '@main/core/download/manager'
import type { StreamProxy } from '@main/core/proxy/stream-proxy'
import { probeUrl } from '@main/core/net/http'
import { resolveCover } from '@main/core/cover'

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
  /** 音源目录 */
  sourceDir: string
  /** 默认下载目录 */
  downloadDir: string
}

/** 注册全部 IPC 处理器，并把服务的推送事件转发到渲染层 */
export function registerIpc(ctx: IpcContext): void {
  const { sources, search, resolver, downloads, proxy } = ctx

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

  /* ------------------------------ 播放 ------------------------------ */

  ipcMain.handle(CH.playGetUrl, (_e, req: MusicUrlRequest) => resolver.resolve(req))

  ipcMain.handle(CH.playGetLyric, (_e, song: Song, sourceIds?: string[]) =>
    resolver.getLyric(song, sourceIds)
  )

  ipcMain.handle(CH.playProbe, (_e, url: string) => probeUrl(url))

  // 渲染层发现音源给了试听片段时会调这里：冷却该源 + 清掉这首歌的缓存
  ipcMain.handle(
    CH.playReportBadSource,
    (_e, sourceId: string, song: Song, reason?: string) => {
      resolver.reportBadSource(sourceId, song, reason)
    }
  )

  // 封面补全：平台没给封面时，按「歌名 + 歌手」去封面质量更稳的平台找一张
  ipcMain.handle(CH.coverResolve, (_e, song: Song) => resolveCover(song))

  /* ------------------------------ 下载 ------------------------------ */

  ipcMain.handle(CH.downloadAdd, (_e, req: DownloadAddRequest) => downloads.add(req))

  ipcMain.handle(CH.downloadList, () => downloads.list())

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
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  downloads.on('progress', (task) => broadcast(EV.downloadProgress, task))
  downloads.on('done', (task) => broadcast(EV.downloadDone, task))
  downloads.on('error', (task) => broadcast(EV.downloadError, task))
  sources.on('changed', (list) => broadcast(EV.sourceChanged, list))
}

/** 释放 IPC 监听（窗口重建时用） */
export function unregisterIpc(): void {
  for (const channel of Object.values(CH)) {
    ipcMain.removeHandler(channel)
  }
}
