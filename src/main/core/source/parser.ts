/**
 * 音源脚本静态解析
 * 从脚本头部注释里提取元信息，并猜测协议格式。
 */
import { createHash } from 'node:crypto'
import type { SourceFormat, SourceMeta } from '@shared/types/source'

/** 脚本头部注释里可识别的字段 */
const META_KEYS: Record<string, keyof SourceMeta> = {
  name: 'name',
  description: 'description',
  describe: 'description',
  desc: 'description',
  version: 'version',
  author: 'author',
  repository: 'repository',
  homepage: 'repository',
  github: 'repository'
}

/**
 * 解析脚本头部的 `@key value` 注释。
 * 只扫描文件前部，避免把业务代码里的 @ 当成元信息。
 */
export function parseSourceMeta(code: string, filename?: string): SourceMeta {
  const head = code.slice(0, 4096)
  const meta: SourceMeta = {}

  const re = /^\s*(?:\/\*+|\*|\/\/)?\s*@([A-Za-z_]+)[ \t]+(.+?)\s*\*?\/?\s*$/gm
  let match: RegExpExecArray | null
  while ((match = re.exec(head)) !== null) {
    const key = META_KEYS[match[1].toLowerCase()]
    if (!key) continue
    const value = match[2].replace(/\*\/\s*$/, '').trim()
    if (!value || meta[key]) continue
    meta[key] = value
  }

  // 兜底：没有 @name 时用文件名（去掉扩展名与常见后缀）
  if (!meta.name && filename) {
    meta.name = filename
      .replace(/\.(js|mjs|cjs|txt)$/i, '')
      .replace(/[-_]?v?\d+(\.\d+)*/gi, '')
      .replace(/音源|source/gi, '')
      .trim() || filename
  }

  return meta
}

/**
 * 猜测脚本使用的协议格式。
 *
 * 注意：混淆脚本无法静态识别（仓库里相当一部分是混淆过的），
 * 因此这只是「初判」，最终以运行时行为为准（是否 send('inited') / 是否赋值 module.exports）。
 */
export function detectSourceFormat(code: string): SourceFormat | 'unknown' {
  // 洛雪特征：解构 globalThis.lx，或出现协议事件名
  const lxSignals = [
    /globalThis\s*\.\s*lx/,
    /window\s*\.\s*lx/,
    /\blx\s*\.\s*EVENT_NAMES/,
    /EVENT_NAMES\s*\.\s*(request|inited)/,
    /\bfrom\s+['"]lx['"]/,
    /qualitys\s*:/
  ]
  if (lxSignals.some((re) => re.test(code))) return 'lx'

  // MusicFree 特征：CommonJS 导出对象，且包含插件钩子名
  const mfSignals = [
    /module\s*\.\s*exports\s*=/,
    /exports\s*\.\s*(search|getMediaSource|getLyric)\s*=/,
    /\bplatform\s*:/
  ]
  if (mfSignals.some((re) => re.test(code))) return 'musicfree'

  return 'unknown'
}

/** 计算脚本文本哈希，用于识别变更 */
export function hashCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex').slice(0, 16)
}

/** 从混淆脚本中尽力提取可读名字（用于日志展示） */
export function safeDisplayName(name: string | undefined, fallback: string): string {
  if (!name) return fallback
  return name.replace(/\s+/g, ' ').trim().slice(0, 60) || fallback
}
