/**
 * 封面补全服务
 *
 * 为什么要它 —— 这是逐个平台实测出来的封面质量：
 *   · 酷我：5 首歌里只有 1 首带封面字段
 *   · 酷狗：那套 stdmusic 地址对任何专辑都返回同一张 17853 字节的占位图（假图）
 *   · QQ / 网易云 / 咪咕：封面正常
 *
 * 所以缺图时跨平台去补。**数据源选 QQ 音乐**，理由是实测对比：
 *   · QQ    —— albumMid 拼出的封面实测 33448 字节真实图，稳定
 *   · 网易云 —— 接口限流严重（GET 直接回「操作频繁」），且返回的 picUrl 常常为空
 *
 * 封面本是跨平台通用资源，没必要被「这首歌来自哪个平台」限制住。
 */
import type { Song } from '@shared/types/music'
import { httpRequest, DEFAULT_UA } from '../net/http'

const QQ_HEADERS = {
  Referer: 'https://y.qq.com/',
  'User-Agent': DEFAULT_UA,
  Accept: 'application/json'
}

type Json = Record<string, any>

function asObj(value: unknown): Json {
  return value && typeof value === 'object' ? (value as Json) : {}
}
function asArr(value: unknown): Json[] {
  return Array.isArray(value) ? (value as Json[]) : []
}
function str(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

/** 剥离 JSONP 包裹（QQ 接口有时会给） */
function unwrapJsonp(body: unknown): unknown {
  if (typeof body !== 'string') return body
  const m = /^[\w$.]+\s*\(([\s\S]*)\)\s*;?$/.exec(body.trim())
  if (!m) return body
  try {
    return JSON.parse(m[1])
  } catch {
    return body
  }
}

/** 缓存：封面基本不变，而且补一张要走一次网络搜索 */
const cache = new Map<string, string | null>()
const CACHE_LIMIT = 2000

function cacheKey(song: Song): string {
  return `${song.name}|${song.singer}`.trim().toLowerCase()
}

/** 去 QQ 音乐搜一张封面 */
async function searchCover(song: Song): Promise<string | null> {
  // 带上第一位歌手，命中率明显高于只用歌名
  const primarySinger = song.singer.split(/[/、,，]/)[0]?.trim() ?? ''
  const keyword = `${song.name} ${primarySinger}`.trim()
  if (!keyword) return null

  const url =
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=3` +
    `&w=${encodeURIComponent(keyword)}&format=json&cr=1&new_json=1`

  const res = await httpRequest(url, { method: 'GET', headers: QQ_HEADERS, timeout: 8000 })
  const body = asObj(unwrapJsonp(res.body))
  const list = asArr(asObj(asObj(body.data).song).list)
  if (list.length === 0) return null

  // 优先歌名完全一致的，避免把翻唱的封面按到原唱头上
  const target = song.name.trim()
  const picked =
    list.find((item) => str(item.title || item.songname).trim() === target) ?? list[0]

  const albumMid = str(asObj(picked.album).mid)
  if (!albumMid) return null

  return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
}

/**
 * 解析一首歌的封面。
 * 取不到就返回 null，交给界面显示占位图标 —— 绝不返回假图。
 */
export async function resolveCover(song: Song): Promise<string | null> {
  const key = cacheKey(song)
  if (cache.has(key)) return cache.get(key) ?? null

  let url: string | null = null
  try {
    url = await searchCover(song)
  } catch {
    // 补图失败不是错误，静默降级即可
    url = null
  }

  if (cache.size >= CACHE_LIMIT) {
    // 半量清理：比全清温和，也不会让 Map 无限增长
    for (const oldKey of [...cache.keys()].slice(0, CACHE_LIMIT / 2)) cache.delete(oldKey)
  }
  cache.set(key, url)
  return url
}
