import type { PlatformId, Quality } from './types/music'

/** 平台元信息 */
export interface PlatformMeta {
  id: PlatformId
  /** 中文全名 */
  name: string
  /** 短标签（UI 色块用） */
  short: string
  /** 品牌色 */
  color: string
}

export const PLATFORM_META: Record<string, PlatformMeta> = {
  kw: { id: 'kw', name: '酷我音乐', short: 'KW', color: '#ffcd32' },
  kg: { id: 'kg', name: '酷狗音乐', short: 'KG', color: '#2ca2f9' },
  tx: { id: 'tx', name: 'QQ音乐', short: 'QQ', color: '#31c27c' },
  wy: { id: 'wy', name: '网易云音乐', short: '163', color: '#c20c0c' },
  mg: { id: 'mg', name: '咪咕音乐', short: 'MG', color: '#ff6a00' },
  local: { id: 'local', name: '本地音乐', short: 'LOC', color: '#7a7a7a' }
}

/** 全部内置支持的平台（搜索层实现的目标平台） */
export const BUILTIN_PLATFORMS: PlatformId[] = ['kw', 'kg', 'tx', 'wy', 'mg']

/** 音质元信息 —— 按音质从高到低排列 */
export interface QualityMeta {
  id: Quality
  name: string
  short: string
  bitrate: string
  /** 排序权重，越大越高 */
  rank: number
}

export const QUALITY_META: Record<string, QualityMeta> = {
  flac24bit: { id: 'flac24bit', name: 'Hi-Res 无损', short: '24BIT', bitrate: '≈2304kbps', rank: 50 },
  hires: { id: 'hires', name: 'Hi-Res 无损', short: 'HIRES', bitrate: '≈2304kbps', rank: 45 },
  flac: { id: 'flac', name: '无损音质', short: 'FLAC', bitrate: '≈1000kbps', rank: 40 },
  '320k': { id: '320k', name: '高品音质', short: '320K', bitrate: '320kbps', rank: 30 },
  '128k': { id: '128k', name: '标准音质', short: '128K', bitrate: '128kbps', rank: 10 }
}

/** 全部音质，从高到低 */
export const QUALITY_ORDER: Quality[] = ['flac24bit', 'hires', 'flac', '320k', '128k']

/** 取音质权重，未知音质给 0 */
export function qualityRank(q: Quality | undefined): number {
  if (!q) return 0
  return QUALITY_META[q]?.rank ?? 0
}

/** 从候选音质中选出不超过期望等级的最高可用音质 */
export function pickQuality(prefer: Quality | undefined, available: Quality[]): Quality | undefined {
  if (!available.length) return undefined
  const sorted = [...available].sort((a, b) => qualityRank(b) - qualityRank(a))
  if (!prefer) return sorted[0]
  const limit = qualityRank(prefer)
  return sorted.find((q) => qualityRank(q) <= limit) ?? sorted[sorted.length - 1]
}

/** 默认下载文件名模板 */
export const DEFAULT_NAME_TEMPLATE = '{singer} - {name}'

/** 应用常量 */
export const APP_CONST = {
  /** 本地流代理默认端口（0 = 随机可用端口） */
  proxyPort: 0,
  /** 音源脚本执行超时 ms */
  sourceInitTimeout: 15000,
  /** 单次取流超时 ms */
  fetchTimeout: 20000,
  /** 搜索单平台超时 ms */
  searchTimeout: 15000,
  /** 音源目录名（位于 userData 下） */
  sourceDirName: 'sources',
  /** 内置音源目录名（位于 resources 下） */
  bundledSourceDirName: 'sources'
} as const
