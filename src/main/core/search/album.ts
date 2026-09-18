/**
 * 专辑搜索
 *
 * 与艺人搜索同一套原理：独立于歌曲搜索的一条链路，
 * 各平台分别适配后统一归一成 AlbumInfo。
 *
 * 实测情况（见 scripts/probe-album.mjs）：
 *   · 网易云  可用，专辑名 / 歌手 / 曲目数 / 封面俱全
 *   · 酷狗    可用，封面 URL 里带 {size} 占位符，替换成 240 即为真实图
 *   · 咪咕    可用
 *   · 酷我    可用，结果在 albumlist 里（不是 abslist），字段名为 name / artist / hts_img
 *   · QQ 音乐 该接口的响应里已经没有 album 字段，不再返回专辑列表，故不实现
 */
import type { AlbumInfo } from '@shared/types/album'
import type { PlatformId } from '@shared/types/music'
import { httpRequest, DEFAULT_UA } from '../net/http'

/* ------------------------------------------------------------------ *
 * 取值工具（与其它搜索模块同款，保持各自独立）
 * ------------------------------------------------------------------ */

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
function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
function cleanText(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 酷我返回单引号字面量 */
function parseLooseJson(text: string): Json {
  let out = ''
  let i = 0
  let inString = false
  let quote = ''
  while (i < text.length) {
    const ch = text[i]
    if (!inString) {
      if (ch === "'" || ch === '"') {
        inString = true
        quote = ch
        out += '"'
        i += 1
        continue
      }
      out += ch
      i += 1
      continue
    }
    if (ch === '\\') {
      const next = text[i + 1]
      if (next === "'") {
        out += "'"
        i += 2
        continue
      }
      if (next === '"') {
        out += '\\"'
        i += 2
        continue
      }
      out += ch + (next ?? '')
      i += 2
      continue
    }
    if (ch === quote) {
      inString = false
      out += '"'
      i += 1
      continue
    }
    if (quote === "'" && ch === '"') {
      out += '\\"'
      i += 1
      continue
    }
    out += ch
    i += 1
  }
  return JSON.parse(out.replace(/,\s*([}\]])/g, '$1')) as Json
}

/* ------------------------------------------------------------------ *
 * 各平台专辑搜索
 * ------------------------------------------------------------------ */

type AlbumSearcher = (keyword: string, page: number, limit: number) => Promise<AlbumInfo[]>

/** 组装统一的专辑对象 */
function build(
  platform: PlatformId,
  data: {
    albumId: string
    name: string
    singer: string
    picUrl?: string
    songCount?: number
    publishTime?: string
    raw?: Json
  }
): AlbumInfo | null {
  const name = cleanText(data.name)
  const albumId = data.albumId.trim()
  // 名字或 id 缺一个就不可用：没名字没法查曲目，没 id 没法去重
  if (!name || !albumId) return null

  return {
    id: `${platform}_${albumId}`,
    platform,
    albumId,
    name,
    singer: cleanText(data.singer),
    picUrl: data.picUrl || undefined,
    songCount: data.songCount,
    publishTime: data.publishTime || undefined,
    providerId: platform,
    raw: data.raw
  }
}

/** 酷我 —— 结果在 albumlist 里 */
const searchKuwo: AlbumSearcher = async (keyword, page, limit) => {
  const url =
    `http://search.kuwo.cn/r.s?all=${encodeURIComponent(keyword)}` +
    `&ft=album&itemset=web_2013&client=kt&pn=${page - 1}&rn=${limit}` +
    `&rformat=json&encoding=utf8`

  const res = await httpRequest(url, {
    method: 'GET',
    headers: {
      Referer: 'http://www.kuwo.cn/',
      'User-Agent': DEFAULT_UA,
      Cookie: 'kw_token=ABCDEFGHIJKLMNOP'
    }
  })

  const body: Json =
    res.body && typeof res.body === 'object'
      ? (res.body as Json)
      : parseLooseJson(String(res.body ?? ''))

  return asArr(body.albumlist)
    .map((item) =>
      build('kw', {
        albumId: str(item.albumid),
        name: str(item.name),
        singer: str(item.artist) || str(item.aartist),
        picUrl: str(item.hts_img) || str(item.img),
        songCount: num(item.musiccnt, 0) || undefined,
        raw: { albumid: str(item.albumid) }
      })
    )
    .filter((x): x is AlbumInfo => x !== null)
}

/** 酷狗 —— 封面 URL 带 {size} 占位符 */
const searchKugou: AlbumSearcher = async (keyword, page, limit) => {
  const url =
    `http://mobilecdn.kugou.com/api/v3/search/album?format=json` +
    `&keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}`

  const res = await httpRequest(url, { method: 'GET', headers: { 'User-Agent': DEFAULT_UA } })
  const body = asObj(res.body)

  // 注意：data 有时直接是数组，有时包在 info 里
  const raw = body.data
  const list = Array.isArray(raw) ? asArr(raw) : asArr(asObj(raw).info)

  return list
    .map((item) =>
      build('kg', {
        albumId: str(item.albumid),
        name: str(item.albumname),
        singer: str(item.singername),
        // 占位符不替换的话会拿到一张坏图
        picUrl: str(item.imgurl).replace('{size}', '240'),
        songCount: num(item.songcount, 0) || undefined,
        raw: { albumid: str(item.albumid) }
      })
    )
    .filter((x): x is AlbumInfo => x !== null)
}

/** 网易云 —— type=10 搜专辑；用 POST，GET 那个已被限流 */
const searchNetease: AlbumSearcher = async (keyword, page, limit) => {
  const res = await httpRequest('https://music.163.com/api/search/get', {
    method: 'POST',
    headers: {
      Referer: 'https://music.163.com/',
      'User-Agent': DEFAULT_UA,
      Cookie: 'appver=2.0.2; os=pc',
      Accept: 'application/json'
    },
    form: {
      s: keyword,
      type: '10',
      offset: String((page - 1) * limit),
      limit: String(limit)
    },
    timeout: 10000
  })

  const body = asObj(res.body)
  const list = asArr(asObj(body.result).albums)

  return list
    .map((item) =>
      build('wy', {
        albumId: str(item.id),
        name: str(item.name),
        singer: str(asObj(item.artist).name),
        picUrl: str(item.picUrl),
        songCount: num(item.size, 0) || undefined,
        raw: { id: str(item.id) }
      })
    )
    .filter((x): x is AlbumInfo => x !== null)
}

/** 咪咕 —— searchSwitch 指定只搜专辑 */
const searchMigu: AlbumSearcher = async (keyword, page, limit) => {
  const searchSwitch = encodeURIComponent(JSON.stringify({ album: 1 }))
  const url =
    `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?text=${encodeURIComponent(keyword)}` +
    `&pageNo=${page}&pageSize=${limit}&isCopyright=1&searchSwitch=${searchSwitch}`

  const res = await httpRequest(url, {
    method: 'GET',
    headers: {
      Referer: 'https://app.c.nf.migu.cn/',
      'User-Agent': DEFAULT_UA,
      Accept: 'application/json'
    }
  })

  const body = asObj(res.body)
  const data = asObj(body.albumResultData)

  return asArr(data.result)
    .map((item) => {
      const images = asArr(item.imgItems)
      return build('mg', {
        albumId: str(item.id),
        name: str(item.name) || str(item.albumName),
        singer: str(item.singer) || str(item.singerName),
        picUrl: str(item.picUrl) || str(images[0]?.img),
        songCount: num(item.songCount ?? item.totalCount, 0) || undefined,
        raw: { id: str(item.id) }
      })
    })
    .filter((x): x is AlbumInfo => x !== null)
}

/** 平台 → 搜索器 */
export const albumSearchers: Record<string, AlbumSearcher> = {
  kw: searchKuwo,
  kg: searchKugou,
  wy: searchNetease,
  mg: searchMigu
}

/** 平台展示名，用于错误提示 */
export const ALBUM_PLATFORM_NAMES: Record<string, string> = {
  kw: '酷我音乐',
  kg: '酷狗音乐',
  wy: '网易云音乐',
  mg: '咪咕音乐'
}
