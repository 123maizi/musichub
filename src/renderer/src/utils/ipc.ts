/**
 * 渲染层 IPC 出口
 *
 * 为什么解包必须在这里做，而不是 preload 里 —— 这是踩过的坑：
 *
 * contextBridge 暴露的函数，参数在「进入 preload 的隔离世界之前」
 * 就会先经历一次结构化转换。Vue 的响应式 Proxy 会在那一步直接抛
 * "An object could not be cloned."，等 preload 里的兜底代码拿到参数时，
 * 错误早就发生了，根本来不及补救。
 *
 * 结论：凡是会把对象送过 IPC 的方法，都在这一层先转成纯数据。
 */
import type { Lyric, LyricTranslateResult, MusicUrlRequest, MusicUrlResult, Song } from '@shared/types/music'
import type { DownloadAddRequest, DownloadTask } from '@shared/types/download'
import type { AiConfig, AiTestResult, SavedTranslation } from '@shared/types/ai'

/**
 * 解包成可结构化克隆的纯数据。
 * 顺带解决另一个隐患：Pinia 列表里的对象是惰性 Proxy，
 * 直接传会连带把整棵响应式树带过去。
 */
export function toPlain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    // 极端情况下（循环引用等）原样透传，让主进程报出真实错误
    return value
  }
}

/** 取播放地址 */
export function getPlayUrl(req: MusicUrlRequest): Promise<MusicUrlResult> {
  return window.api.player.getUrl({ ...req, song: toPlain(req.song) })
}

/** 取歌词 */
export function getLyric(song: Song, sourceIds?: string[]): Promise<Lyric | null> {
  return window.api.player.getLyric(toPlain(song), sourceIds)
}

/**
 * 翻译歌词。
 * lyric 里可能挂着从主进程传来的 Proxy 包装，必须先拆成纯对象再过 IPC，
 * 否则会报 "An object could not be cloned"。
 * song 一并传过去，让 AI 知道自己在翻哪首歌。
 */
export function translateLyric(
  lyric: Lyric,
  target?: string,
  song?: Song
): Promise<LyricTranslateResult> {
  return window.api.player.translateLyric(
    toPlain(lyric),
    target,
    song ? toPlain(song) : undefined
  )
}

/** 加入下载队列（songs 通常直接来自响应式列表） */
export function addDownload(req: DownloadAddRequest): Promise<DownloadTask[]> {
  return window.api.download.add({ ...req, songs: req.songs.map((song) => toPlain(song)) })
}

/**
 * 上报音源质量问题（目前用于「只给试听片段」）。
 * 主进程会冷却该音源并清掉这首歌的取流缓存，于是下次请求自动换源。
 */
export function reportBadSource(sourceId: string, song: Song, reason?: string): Promise<void> {
  return window.api.player.reportBadSource(sourceId, toPlain(song), reason)
}

/**
 * 补全封面。
 * 平台没给封面（酷我大多没有）时，用「歌名 + 歌手」去封面更全的平台找一张。
 */
export function resolveCover(song: Song): Promise<string | null> {
  return window.api.player.resolveCover(toPlain(song))
}

/** 把封面存到本地（默认存进下载目录，文件名与歌曲一致） */
export function downloadCover(
  song: Song,
  dir?: string
): Promise<{ path: string; bytes: number; from: 'platform' | 'resolved' }> {
  return window.api.player.downloadCover(toPlain(song), dir)
}

/* ------------------------------ AI 翻译 ------------------------------ */

/** 读 AI 配置（含 Key，用于设置页回显） */
export function getAiConfig(): Promise<AiConfig> {
  return window.api.ai.getConfig()
}

/** 更新 AI 配置 */
export function setAiConfig(patch: Partial<AiConfig>): Promise<AiConfig> {
  return window.api.ai.setConfig(toPlain(patch))
}

/** 测试 AI 连接；顺带拿回服务端可用模型列表 */
export function testAi(): Promise<AiTestResult> {
  return window.api.ai.test()
}

/* ------------------------------ 译文存取 ------------------------------ */

/** 读已保存的译文（切歌回来、重启后都还在） */
export function getSavedTranslation(songId: string): Promise<SavedTranslation | null> {
  return window.api.ai.getSaved(songId)
}

/** 保存译文；手工编辑时 edited 传 true */
export function saveTranslation(entry: SavedTranslation): Promise<SavedTranslation> {
  return window.api.ai.saveTranslation(toPlain(entry))
}

/** 删除译文，相当于「重新翻一遍」 */
export function deleteSavedTranslation(songId: string): Promise<void> {
  return window.api.ai.deleteSaved(songId)
}
