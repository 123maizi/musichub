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

/**
 * 下载格式选项。
 *
 * 「音质」这个词对用户来说是抽象的 —— 他想的是「我要一个 MP3」。
 * 所以下载界面直接摆出格式本身：MP3 / FLAC / 24bit，各自标清楚码率和体积。
 * id 就是取流层的音质档位，不需要额外的转换层。
 */
export interface DownloadFormatOption {
  /** 存进 download-config.preferQuality 的值 */
  id: Quality
  /** 格式名，最大的那行字 */
  format: string
  /** 码率副标签 */
  rate: string
  /** 一句人话说明 */
  note: string
  /** 期望的容器扩展名（仅用于界面，真实容器以文件指纹为准） */
  ext: string
  lossless: boolean
}

export const DOWNLOAD_FORMATS: DownloadFormatOption[] = [
  {
    id: '320k',
    format: 'MP3',
    rate: '320Kbps',
    note: '通用性最好 —— 手机、车机、蓝牙音箱都能直接放',
    ext: 'mp3',
    lossless: false
  },
  {
    id: '128k',
    format: 'MP3',
    rate: '128Kbps',
    note: '体积最小，同样时长大约只有 320K 的四成',
    ext: 'mp3',
    lossless: false
  },
  {
    id: 'flac',
    format: 'FLAC',
    rate: '无损',
    note: '与 CD 同源，体积约为 MP3 的 5 倍，适合收藏',
    ext: 'flac',
    lossless: true
  },
  {
    id: 'flac24bit',
    format: 'FLAC',
    rate: '24bit 母带',
    note: 'Hi-Res 规格，发烧级；音源没有时自动降到无损',
    ext: 'flac',
    lossless: true
  }
]

/**
 * 历史遗留的音质值 → 现在的格式档位。
 * 老配置里可能存着 hires，界面上要能对应到「24bit 母带」那一项，
 * 否则用户打开下载页会看到一个没有任何按钮被选中的空白状态。
 */
export const FORMAT_ALIASES: Record<string, Quality> = { hires: 'flac24bit' }

/** 把配置里存的音质值归一到某个格式选项 */
export function normalizeFormatId(id: Quality | undefined): Quality | undefined {
  if (!id) return undefined
  return FORMAT_ALIASES[id] ?? id
}

/** 按 id 找格式选项 */
export function findFormat(id: Quality | undefined): DownloadFormatOption | undefined {
  const normalized = normalizeFormatId(id)
  if (!normalized) return undefined
  return DOWNLOAD_FORMATS.find((f) => f.id === normalized)
}

/**
 * 从文件名推断真实容器，给界面显示用。
 * 只认扩展名，不做内容嗅探 —— 内容在下载时已经校验过了。
 */
export function containerOf(fileName: string): string {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase()
  if (ext === 'mp3') return 'MP3'
  if (ext === 'flac') return 'FLAC'
  if (ext === 'm4a' || ext === 'mp4') return 'M4A'
  if (ext === 'ogg' || ext === 'oga') return 'OGG'
  if (ext === 'wav') return 'WAV'
  if (ext === 'aac') return 'AAC'
  if (ext === 'wma') return 'WMA'
  if (ext === 'webm') return 'WEBM'
  return ext ? ext.toUpperCase() : '—'
}

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
