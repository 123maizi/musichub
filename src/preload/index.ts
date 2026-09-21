/**
 * 预加载脚本
 *
 * 渲染层与主进程之间唯一的桥。这里刻意不做「任意通道转发」，
 * 而是逐个方法显式暴露，保证攻击面可控（渲染层无法调用未列出的能力）。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { CH, EV } from '@shared/ipc-channels'
import type { Lyric, LyricTranslateResult, MusicUrlRequest, SearchRequest, Song } from '@shared/types/music'
import type { AiConfig, AiTestResult, SavedTranslation } from '@shared/types/ai'
import type { DownloadAddRequest, DownloadConfig } from '@shared/types/download'
import type { AppInfo } from '@shared/types/ipc'

/** 注销函数：调用后停止监听 */
type Unsubscribe = () => void

/**
 * 结构化克隆不接受 Vue 的响应式 Proxy。
 *
 * Pinia store 里的对象都是 reactive 代理，直接丢给 ipcRenderer.invoke 会抛
 * "An object could not be cloned"。这里统一解包成纯数据再跨进程传递 ——
 * 放在这一层收口，渲染层各处就都不用操心这件事。
 */
function toPlain(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value)) as unknown
  } catch {
    // 万一遇到循环引用等无法序列化的情况，原样透传，让主进程报出真实错误
    return value
  }
}

/** 带解包的统一 invoke；返回类型与 ipcRenderer.invoke 保持一致 */
function invoke(channel: string, ...args: unknown[]): Promise<any> {
  return ipcRenderer.invoke(channel, ...args.map(toPlain))
}

const api = {
  /* ------------------------------ 音源 ------------------------------ */
  source: {
    list: () => invoke(CH.sourceList),
    importFiles: (paths: string[]) => invoke(CH.sourceImportFiles, paths),
    importFromDialog: () => invoke(CH.sourceImportDialog),
    importFromUrl: (url: string) => invoke(CH.sourceImportUrl, url),
    importBundled: () => invoke(CH.sourceImportBundled),
    remove: (ids: string[]) => invoke(CH.sourceRemove, ids),
    toggle: (id: string, enabled: boolean) => invoke(CH.sourceToggle, id, enabled),
    reload: (id: string) => invoke(CH.sourceReload, id),
    readSource: (id: string) => invoke(CH.sourceRead, id),
    writeSource: (id: string, code: string) => invoke(CH.sourceWrite, id, code),
    openDir: () => invoke(CH.sourceOpenDir)
  },

  /* ------------------------------ 搜索 ------------------------------ */
  search: {
    search: (req: SearchRequest) => invoke(CH.searchMulti, req),
    providers: () => invoke(CH.searchProviders),
    /** 艺人（歌手）搜索：返回五个平台各自的艺人列表 */
    artists: (keyword: string, platforms?: string[]) =>
      invoke(CH.searchArtists, keyword, platforms) as Promise<
        import('@shared/types/artist').ArtistSearchResponse
      >,
    /** 专辑搜索：返回各平台各自的专辑列表 */
    albums: (keyword: string, platforms?: string[]) =>
      invoke(CH.searchAlbums, keyword, platforms) as Promise<
        import('@shared/types/album').AlbumSearchResponse
      >
  },

  /* ------------------------------ 播放 ------------------------------ */
  player: {
    getUrl: (req: MusicUrlRequest) => invoke(CH.playGetUrl, req),
    getLyric: (song: Song, sourceIds?: string[]) =>
      invoke(CH.playGetLyric, song, sourceIds) as Promise<Lyric | null>,
    /**
     * 歌词翻译（外语歌没有官方翻译时用）。
     * 带上 song 是为了把歌名/歌手/专辑一并告诉 AI —— 模型知道在翻哪首歌，
     * 人名与专有名词会准得多。
     */
    translateLyric: (lyric: Lyric, target?: string, song?: Song) =>
      invoke(CH.playTranslateLyric, lyric, target, song) as Promise<LyricTranslateResult>,
    probe: (url: string) => invoke(CH.playProbe, url),
    /**
     * 上报音源质量问题（例如只返回试听片段）。
     * 主进程会冷却该音源并清掉这首歌的取流缓存，让下次请求自动换源。
     */
    reportBadSource: (sourceId: string, song: Song, reason?: string) =>
      invoke(CH.playReportBadSource, sourceId, song, reason),
    /** 封面补全：平台没给封面时，按「歌名 + 歌手」去别处找一张 */
    resolveCover: (song: Song) => invoke(CH.coverResolve, song)
  },

  /* ------------------------------ AI 翻译 ------------------------------ */
  ai: {
    getConfig: () => invoke(CH.aiGetConfig) as Promise<AiConfig>,
    setConfig: (patch: Partial<AiConfig>) => invoke(CH.aiSetConfig, patch) as Promise<AiConfig>,
    /** 测试连通性，顺带拿回服务端的可用模型列表 */
    test: () => invoke(CH.aiTest) as Promise<AiTestResult>,
    /** 读已保存的译文：切歌回来、重启后都还在 */
    getSaved: (songId: string) => invoke(CH.lyricSavedGet, songId) as Promise<SavedTranslation | null>,
    /** 保存译文（手工编辑时 edited 传 true，此后不再被自动翻译覆盖） */
    saveTranslation: (entry: SavedTranslation) =>
      invoke(CH.lyricSavedSet, entry) as Promise<SavedTranslation>,
    /** 删掉译文，相当于「重新翻一遍」 */
    deleteSaved: (songId: string) => invoke(CH.lyricSavedDelete, songId)
  },

  /* ------------------------------ 下载 ------------------------------ */
  download: {
    add: (req: DownloadAddRequest) => invoke(CH.downloadAdd, req),
    list: () => invoke(CH.downloadList),
    pause: (ids: string[]) => invoke(CH.downloadPause, ids),
    resume: (ids: string[]) => invoke(CH.downloadResume, ids),
    remove: (ids: string[], deleteFile = false) =>
      invoke(CH.downloadRemove, ids, deleteFile),
    retry: (ids: string[]) => invoke(CH.downloadRetry, ids),
    clearFinished: () => invoke(CH.downloadClear),
    getConfig: () => invoke(CH.downloadGetConfig) as Promise<DownloadConfig>,
    setConfig: (patch: Partial<DownloadConfig>) =>
      invoke(CH.downloadSetConfig, patch) as Promise<DownloadConfig>,
    chooseDir: () => invoke(CH.downloadChooseDir) as Promise<string | null>,
    openFile: (path: string) => invoke(CH.downloadOpenFile, path),
    showInFolder: (path: string) => invoke(CH.downloadShowInFolder, path)
  },

  /* ------------------------------ 音乐库 ------------------------------ */
  /**
   * 我的喜欢 / 历史播放 / 歌单。
   * 注意：涉及歌曲对象的方法，渲染层必须先把对象解包成纯数据
   * （见 renderer/src/utils/ipc.ts 的说明），这里不代劳。
   */
  library: {
    snapshot: () => invoke(CH.librarySnapshot),
    stats: () => invoke(CH.libraryStats),
    toggleFavorite: (song: Song) => invoke(CH.libraryToggleFavorite, song),
    clearFavorites: () => invoke(CH.libraryClearFavorites),
    recordPlay: (song: Song) => invoke(CH.libraryRecordPlay, song),
    removeHistory: (songIds: string[]) => invoke(CH.libraryRemoveHistory, songIds),
    clearHistory: () => invoke(CH.libraryClearHistory),
    playlist: (action: import('@shared/types/library').PlaylistAction) =>
      invoke(CH.libraryPlaylist, action)
  },

  /* ------------------------------ 应用 ------------------------------ */
  app: {
    info: () => invoke(CH.appInfo) as Promise<AppInfo>,
    openExternal: (url: string) => invoke(CH.appOpenExternal, url),
    toggleDevTools: () => invoke(CH.appToggleDevTools),
    minimize: () => ipcRenderer.send(CH.appMinimize),
    maximize: () => ipcRenderer.send(CH.appMaximize),
    close: () => ipcRenderer.send(CH.appClose)
  },

  /* ------------------------------ 事件订阅 ------------------------------ */
  /** 订阅主进程推送，返回取消订阅函数 */
  on: (channel: string, callback: (payload: unknown) => void): Unsubscribe => {
    const allowed: string[] = Object.values(EV)
    if (!allowed.includes(channel)) {
      throw new Error(`未授权的事件通道: ${channel}`)
    }
    const listener = (_event: unknown, payload: unknown): void => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },

  /** 事件通道名，供渲染层引用而不必手写字符串 */
  events: EV
}

contextBridge.exposeInMainWorld('api', api)

export type RendererApi = typeof api
