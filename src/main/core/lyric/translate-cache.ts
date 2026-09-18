/**
 * 歌词翻译缓存
 *
 * 为什么必须有：翻译走的是公共免费接口，额度按 IP 算。
 * 同一首歌反复播放、反复切歌回来，如果每次都重新翻，额度会被迅速烧光
 * （上一版就吃过这个亏——验证时整首整首地测，把当天额度和用户都拖下水）。
 *
 * 缓存键由「源语言 + 目标语言 + 原文」三者哈希而成：
 * 歌词只要有一个字不同就是另一份，绝不会张冠李戴。
 *
 * 纯 Node 环境下（验证脚本）拿不到 electron.app，这时自动降级为
 * 只用内存缓存，不落盘，也不报错。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 最多保留多少条；超出后按最后使用时间淘汰最旧的 */
const MAX_ENTRIES = 500

interface Entry {
  /** 译文 LRC */
  lrc: string
  /** 最后使用时间戳（用于淘汰） */
  at: number
}

interface StoreShape {
  version: number
  entries: Record<string, Entry>
}

const memory: Record<string, Entry> = {}
let loaded = false
let filePath = ''

/** 缓存文件路径；拿不到 electron 就返回空串（纯 Node 场景） */
function resolveFile(): string {
  if (filePath) return filePath
  try {
    if (typeof require !== 'function') return ''
    // 主进程打包产物是 CJS，这里能直接 require
    const electron = require('electron') as typeof import('electron')
    const dir = electron.app?.getPath?.('userData')
    if (!dir) return ''
    filePath = join(dir, 'lyric-translations.json')
    return filePath
  } catch {
    return ''
  }
}

function load(): void {
  if (loaded) return
  loaded = true
  const file = resolveFile()
  if (!file || !existsSync(file)) return
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as StoreShape
    if (parsed && parsed.version === 1 && parsed.entries) {
      Object.assign(memory, parsed.entries)
    }
  } catch {
    // 缓存文件坏了不算大事，丢掉重来，绝不因此让翻译功能报错
  }
}

function persist(): void {
  const file = resolveFile()
  if (!file) return
  try {
    const dir = dirname(file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    // 超限则淘汰最久未使用的
    const keys = Object.keys(memory)
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => memory[a].at - memory[b].at)
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => delete memory[k])
    }

    const payload: StoreShape = { version: 1, entries: memory }
    writeFileSync(file, JSON.stringify(payload), 'utf8')
  } catch {
    // 写不进去也不影响本次翻译结果
  }
}

function hashOf(sourceLang: string, target: string, lrc: string): string {
  return createHash('sha1').update(`${sourceLang}|${target}|${lrc}`).digest('hex')
}

/** 取缓存的译文；没有则返回 null */
export function getCachedTranslation(
  sourceLang: string,
  target: string,
  lrc: string
): string | null {
  load()
  const entry = memory[hashOf(sourceLang, target, lrc)]
  if (!entry) return null
  entry.at = Date.now()
  return entry.lrc
}

/** 写入缓存 */
export function putCachedTranslation(
  sourceLang: string,
  target: string,
  lrc: string,
  translated: string
): void {
  load()
  memory[hashOf(sourceLang, target, lrc)] = { lrc: translated, at: Date.now() }
  persist()
}

/** 缓存规模（诊断用） */
export function cacheSize(): number {
  load()
  return Object.keys(memory).length
}
