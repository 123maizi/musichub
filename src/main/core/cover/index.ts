/**
 * 封面补全服务
 *
 * 为什么需要它 —— 这是实测出来的结论：
 *   · 酷我：5 首歌里只有 1 首带封面字段
 *   · 酷狗：那套 stdmusic 地址对任何专辑都返回同一张 17853 字节的占位图（假图）
 *   · QQ / 网易云 / 咪咕：封面正常
 *
 * 与其给用户看假图或缺图，不如按「歌名 + 歌手」去封面质量最稳的网易云补一张。
 * 封面是跨平台通用的资源，没必要被「当前这首歌来自哪个平台」限制住。
 */
import { createHash } from 'node:crypto'

import type { Song } from '@shared/types/music'
import { httpRequest } from '../net/http'

const HEADERS = {
  Referer: 'https://music.163.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Cookie: 'appver=2.0.2; os=pc',
  Accept: 'application/json'
}

/** 网易 CDN 封面密钥（平台固定公开串） */
const MAGIC = '3go8&$8*3*3h0k(2)2'

/**
 * 把网易的 picId 转成可直接访问的封面地址。
 * 网易不允许拿 picId 直接取图，必须先做一次「逐字节异或 + md5 取 base64」再拼进 CDN 路径。
 */
function buildPicUrl(picId: string, size = 300): string | undefined {
  if (!picId) return undefined

  const key = Buffer.alloc(picId.length)
  for (let i = 0; i < picId.length; i += 1) {
    key[i] = picId.charCodeAt(i) ^ MAGIC.charCodeAt(i % MAGIC.length)
  }

  const encrypted = createHash('md5')
    .update(key)
    .digest('base64')
    .replace(/\//g, '_')
    .replace(/\+/g, '-')

  return `https://p3.music.126.net/${encrypted}/${picId}.jpg?param=${size}y${size}`
}

/**
 * 缓存：key 为「歌名|歌手」。
 * 封面基本不会变，而且补全要走一次网络搜索，缓存能省掉大量重复请求。
 */
const cache = new Map<string, string | null>()
const CACHE_LIMIT = 2000

function cacheKey(song: Song): string {
  return `${song.name}|${song.singer}`.trim().toLowerCase()
}

/** 去网易云搜一张封面 */
async function searchCover(song: Song): Promise<string | null> {
  // 带上第一位歌手，命中率明显高于只用歌名
  const primarySinger = song.singer.split(/[/、,，]/)[0]?.trim() ?? ''
  const keyword = `${song.name} ${primarySinger}`.trim()
  if (!keyword) return null

  const url =
    `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}` +
    `&type=1&offset=0&limit=3&total=true`

  const res = await httpRequest(url, { method: 'GET', headers: HEADERS, timeout: 8000 })
  const body = (res.body ?? {}) as Record<string, unknown>
  const result = (body.result ?? {}) as Record<string, unknown>
  const list = Array.isArray(result.songs) ? (result.songs as Record<string, unknown>[]) : []
  if (list.length === 0) return null

  // 优先选歌名完全一致的，避免把翻唱的封面按到原唱头上
  const target = song.name.trim()
  const picked = list.find((item) => String(item.name ?? '').trim() === target) ?? list[0]

  // 老接口用 item.album，新接口用 item.al —— 两个都要试
  const album = (picked.album ?? {}) as Record<string, unknown>
  const albumList = Array.isArray(picked.al) ? (picked.al as Record<string, unknown>[]) : []
  const firstAlbum = albumList[0] ?? {}

  const direct =
    (typeof album.picUrl === 'string' && album.picUrl) ||
    (typeof firstAlbum.picUrl === 'string' && firstAlbum.picUrl)
  if (direct) return direct

  return buildPicUrl(String(album.picId ?? firstAlbum.picId ?? '')) ?? null
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
