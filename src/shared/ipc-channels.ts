/**
 * IPC 通道名常量
 * 放在 shared 层，保证主进程与 preload 用的是同一份定义，
 * 从根上杜绝「通道名写歪导致调用无响应」这类低级问题。
 */

/** 请求-响应通道（ipcRenderer.invoke ↔ ipcMain.handle） */
export const CH = {
  // 音源
  sourceList: 'source:list',
  sourceImportFiles: 'source:importFiles',
  sourceImportDialog: 'source:importDialog',
  sourceImportUrl: 'source:importUrl',
  sourceImportBundled: 'source:importBundled',
  sourceRemove: 'source:remove',
  sourceToggle: 'source:toggle',
  sourceReload: 'source:reload',
  sourceRead: 'source:read',
  sourceWrite: 'source:write',
  sourceOpenDir: 'source:openDir',
  // 搜索
  searchMulti: 'search:multi',
  searchProviders: 'search:providers',
  // 播放
  playGetUrl: 'play:getUrl',
  playGetLyric: 'play:getLyric',
  playProbe: 'play:probe',
  // 下载
  downloadAdd: 'download:add',
  downloadList: 'download:list',
  downloadPause: 'download:pause',
  downloadResume: 'download:resume',
  downloadRemove: 'download:remove',
  downloadRetry: 'download:retry',
  downloadClear: 'download:clear',
  downloadGetConfig: 'download:getConfig',
  downloadSetConfig: 'download:setConfig',
  downloadChooseDir: 'download:chooseDir',
  downloadOpenFile: 'download:openFile',
  downloadShowInFolder: 'download:showInFolder',
  // 音乐库（我的喜欢 / 历史播放 / 歌单）
  librarySnapshot: 'library:snapshot',
  libraryStats: 'library:stats',
  libraryToggleFavorite: 'library:toggleFavorite',
  libraryClearFavorites: 'library:clearFavorites',
  libraryRecordPlay: 'library:recordPlay',
  libraryRemoveHistory: 'library:removeHistory',
  libraryClearHistory: 'library:clearHistory',
  libraryPlaylist: 'library:playlist',
  // 应用
  appInfo: 'app:info',
  appOpenExternal: 'app:openExternal',
  appToggleDevTools: 'app:toggleDevTools',
  appMinimize: 'app:minimize',
  appMaximize: 'app:maximize',
  appClose: 'app:close'
} as const

/** 主进程 → 渲染层 推送通道 */
export const EV = {
  downloadProgress: 'download:progress',
  downloadDone: 'download:done',
  downloadError: 'download:error',
  sourceChanged: 'source:changed',
  log: 'log'
} as const

export type ChannelKey = keyof typeof CH
export type EventKey = keyof typeof EV
