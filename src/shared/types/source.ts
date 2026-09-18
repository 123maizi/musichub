/**
 * 音源（Source）体系类型
 *
 * 兼容两套协议：
 * 1. lx         —— 洛雪音乐（lx-music-desktop）音源脚本，宿主注入 globalThis.lx
 * 2. musicfree  —— MusicFree 插件，CommonJS module.exports 导出对象
 */
import type { PlatformId, Quality } from './music'

/** 音源协议格式 */
export type SourceFormat = 'lx' | 'musicfree'

/** 音源可响应的 action */
export type SourceAction = 'musicUrl' | 'lyric' | 'pic' | 'musicSearch'

/** 音源运行状态 */
export type SourceStatus = 'idle' | 'loading' | 'ready' | 'error' | 'disabled'

/** 音源声明的单平台能力（来自脚本 send('inited') 上报） */
export interface SourceCapability {
  /** 平台标识 */
  platform: PlatformId
  /** 平台展示名（脚本给的 name 字段） */
  name: string
  /** 支持的 action 列表 */
  actions: SourceAction[]
  /** 支持的音质（降序） */
  qualities: Quality[]
}

/** 音源实例信息（对外暴露给渲染层的视图） */
export interface SourceInfo {
  id: string
  /** 展示名：脚本头 @name > 文件名 */
  name: string
  description?: string
  version?: string
  author?: string
  /** 脚本来源仓库 */
  repository?: string
  format: SourceFormat
  status: SourceStatus
  enabled: boolean
  /** 脚本文件绝对路径 */
  path: string
  /** 内容哈希，用于识别脚本变更 */
  hash: string
  /** 脚本大小（字节） */
  size: number
  /** 能力列表 */
  capabilities: SourceCapability[]
  /** 覆盖的平台（去重） */
  platforms: PlatformId[]
  /** 最高可用音质 */
  maxQuality?: Quality
  /** 加载失败原因 */
  error?: string
  /** 脚本内 console 输出尾部（便于排查） */
  logs?: string[]
  loadedAt?: number
  /** 累计取流成功 / 失败次数，用于可用性排序 */
  stat: SourceStat
}

/** 音源可用性统计 */
export interface SourceStat {
  success: number
  fail: number
  /** 最近一次成功耗时 ms */
  lastCost?: number
  /** 最近一次成功时间戳 */
  lastSuccessAt?: number
  /** 连续失败次数 */
  consecutiveFail: number
}

/** 导入音源结果 */
export interface SourceImportResult {
  imported: SourceInfo[]
  failed: { path: string; error: string }[]
  /** 跳过的重复项 */
  skipped: string[]
}

/** 音源脚本解析出的元信息（脚本头注释） */
export interface SourceMeta {
  name?: string
  description?: string
  version?: string
  author?: string
  repository?: string
}
