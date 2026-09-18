/**
 * IPC 契约
 * 主进程 / 预加载 / 渲染层三方共享的唯一接口真相
 */
import type { Lyric, MusicUrlRequest, MusicUrlResult, SearchRequest, SearchResponse, Song } from './music'
import type { DownloadAddRequest, DownloadConfig, DownloadTask } from './download'
import type { SourceImportResult, SourceInfo } from './source'

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  /** 用户数据目录 */
  userDataPath: string
  /** 音源存放目录 */
  sourceDir: string
  /** 默认下载目录 */
  downloadDir: string
  /** 本地流代理端口 */
  proxyPort: number
}

/** 音源相关 API */
export interface SourceApi {
  /** 列出全部音源 */
  list(): Promise<SourceInfo[]>
  /** 从文件导入音源 */
  importFiles(paths: string[]): Promise<SourceImportResult>
  /** 弹出文件选择框并导入 */
  importFromDialog(): Promise<SourceImportResult>
  /** 从 URL 导入音源 */
  importFromUrl(url: string): Promise<SourceImportResult>
  /** 从内置音源目录批量导入（首次运行时用） */
  importBundled(): Promise<SourceImportResult>
  /** 删除音源 */
  remove(ids: string[]): Promise<void>
  /** 启用 / 禁用 */
  toggle(id: string, enabled: boolean): Promise<SourceInfo>
  /** 重新加载（脚本改动后） */
  reload(id: string): Promise<SourceInfo>
  /** 读取脚本源码 */
  readSource(id: string): Promise<string>
  /** 保存脚本源码并重载 */
  writeSource(id: string, code: string): Promise<SourceInfo>
  /** 打开音源所在目录 */
  openDir(): Promise<void>
}

/** 搜索相关 API */
export interface SearchApi {
  /** 多平台聚合搜索 */
  search(req: SearchRequest): Promise<SearchResponse>
  /** 搜索建议 */
  suggest(keyword: string): Promise<string[]>
}

/** 播放相关 API */
export interface PlayerApi {
  /** 获取播放地址 */
  getUrl(req: MusicUrlRequest): Promise<MusicUrlResult>
  /** 获取歌词 */
  getLyric(song: Song, sourceIds?: string[]): Promise<Lyric | null>
  /** 校验地址是否可用（HEAD 探测） */
  probe(url: string): Promise<{ ok: boolean; size?: number; ext?: string; error?: string }>
}

/** 下载相关 API */
export interface DownloadApi {
  add(req: DownloadAddRequest): Promise<DownloadTask[]>
  list(): Promise<DownloadTask[]>
  pause(ids: string[]): Promise<void>
  resume(ids: string[]): Promise<void>
  remove(ids: string[], deleteFile: boolean): Promise<void>
  retry(ids: string[]): Promise<void>
  clearFinished(): Promise<void>
  getConfig(): Promise<DownloadConfig>
  setConfig(cfg: Partial<DownloadConfig>): Promise<DownloadConfig>
  chooseDir(): Promise<string | null>
  openFile(path: string): Promise<void>
  showInFolder(path: string): Promise<void>
}

/** 应用相关 API */
export interface AppApi {
  info(): Promise<AppInfo>
  minimize(): void
  maximize(): void
  close(): void
  openExternal(url: string): Promise<void>
  /** 打开开发者工具 */
  toggleDevTools(): void
}

/** 主进程推送事件（renderer 监听） */
export interface MainEvents {
  'download:progress': DownloadTask
  'download:done': DownloadTask
  'download:error': DownloadTask
  'source:changed': SourceInfo[]
  'log': { level: 'info' | 'warn' | 'error'; scope: string; message: string; time: number }
}
