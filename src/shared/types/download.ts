/**
 * 下载体系类型
 */
import type { Quality, Song } from './music'

/** 下载任务状态 */
export type DownloadStatus =
  | 'waiting'
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'done'
  | 'error'
  | 'cancelled'

/** 下载任务 */
export interface DownloadTask {
  id: string
  song: Song
  /** 目标音质 */
  quality: Quality
  /** 状态 */
  status: DownloadStatus
  /** 已下载字节 */
  received: number
  /** 总字节（0 表示未知） */
  total: number
  /** 进度 0~100 */
  progress: number
  /** 速度 字节/秒 */
  speed: number
  /** 保存路径 */
  savePath: string
  /** 文件名 */
  fileName: string
  /** 实际提供音源 */
  sourceId?: string
  sourceName?: string
  /** 错误信息 */
  error?: string
  /** 创建时间 */
  createdAt: number
  /** 完成时间 */
  finishedAt?: number
  /** 是否写入元数据标签 */
  writeTag: boolean
}

/** 新建下载任务参数 */
export interface DownloadAddRequest {
  songs: Song[]
  /** 指定音质；不传则自动择优 */
  quality?: Quality
  /** 指定音源 id；不传则自动择优 */
  sourceIds?: string[]
  /** 是否写入标签 */
  writeTag?: boolean
}

/** 下载配置 */
export interface DownloadConfig {
  /** 保存目录 */
  dir: string
  /** 文件名模板，支持 {name} {singer} {album} {quality} {platform} */
  nameTemplate: string
  /** 命名冲突策略 */
  conflict: 'rename' | 'overwrite' | 'skip'
  /** 并发下载数 */
  concurrency: number
  /** 单文件最大重试次数 */
  retry: number
  /** 是否写入元数据标签 */
  writeTag: boolean
  /** 是否下载封面 */
  downloadCover: boolean
  /** 是否下载歌词 */
  downloadLyric: boolean
  /** 固定音质（自动降级策略：优先该音质，失败依次降级） */
  preferQuality: Quality
}
