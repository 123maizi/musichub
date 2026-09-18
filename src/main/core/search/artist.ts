/**
 * 艺人（歌手）搜索
 *
 * 独立于歌曲搜索的一条链路 —— 刻意不去动已经稳定的 builtin.ts。
 *
 * 五个平台的歌手接口返回结构完全不同（字段名、嵌套层级都不一样），
 * 这里逐个适配后统一归一成 ArtistInfo。实测情况：
 *   · QQ / 网易云：信息最全，带头像、歌曲数、专辑数
 *   · 酷我 / 酷狗 / 咪咕：只给名字和 id
 * 后者依然有用 —— 点进去用歌手名搜作品，照样能拿到全部歌曲。
 */
import type { ArtistInfo } from '@shared/types/artist'
import type { PlatformId } from '@shared/types/music'
import { httpRequest, DEFAULT_UA } from '../net/http'

/* ------------------------------------------------------------------ *
 * 取值工具（与 builtin.ts 同款，这里独立一份以保持模块自洽）
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

/** 酷我返回单引号字面量，需要宽松解析 */
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
 * 各平台艺人搜索
 * ------------------------------------------------------------------ */

type ArtistSearcher = (keyword: string, page: number, limit: number) => Promise<ArtistInfo[]>

/** 组装统一的艺人对象 */
function build(
  platform: PlatformId,
  data: {
    artistId: string
    name: string
    alias?: string
    picUrl?: string
    songCount?: number
    albumCount?: number
    raw?: Json
  }
): ArtistInfo | null {
  const name = cleanText(data.name)
  const artistId = data.artistId.trim()
  // 名字或 id 缺一个就不可用：没名字没法搜作品，没 id 没法去重
  if (!name || !artistId) return null

  return {
    id: `${platform}_${artistId}`,
    platform,
    artistId,
    name,
    alias: data.alias || undefined,
    picUrl: data.picUrl || undefined,
    songCount: data.songCount,
    albumCount: data.albumCount,
    providerId: platform,
    raw: data.raw
  }
}

/** 酷我 —— 歌手搜索（ft=artist），只给名字和 id */
const searchKuwo: ArtistSearcher = async (keyword, page, limit) => {
  const url =
    `http://search.kuwo.cn/r.s?all=${encodeURIComponent(keyword)}` +
    `&ft=artist&itemset=web_2013&client=kt&pn=${page - 1}&rn=${limit}` +
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

  return asArr(body.abslist)
    .map((item) =>
      build('kw', {
        artistId: str(item.ARTISTID),
        name: str(item.ARTIST),
        picUrl: str(item.ARTISTPIC) || str(item.web_artistpic) || str(item.hts_ARTISTPIC),
        raw: { ARTISTID: str(item.ARTISTID) }
      })
    )
    .filter((x): x is ArtistInfo => x !== null)
}

/** 酷狗 —— data 直接就是数组，只有名字和 id */
const searchKugou: ArtistSearcher = async (keyword, page, limit) => {
  const url =
    `http://mobilecdn.kugou.com/api/v3/search/singer?format=json` +
    `&keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}`

  const res = await httpRequest(url, { method: 'GET', headers: { 'User-Agent': DEFAULT_UA } })
  const body = asObj(res.body)

  // 注意：这里是 data 而非 data.info
  return asArr(body.data)
    .map((item) =>
      build('kg', {
        artistId: str(item.singerid),
        name: str(item.singername),
        picUrl: str(item.imgurl),
        raw: { singerid: str(item.singerid) }
      })
    )
    .filter((x): x is ArtistInfo => x !== null)
}

/** QQ 音乐 —— 字段是 camelCase，且信息最全 */
const searchQQ: ArtistSearcher = async (keyword, page, limit) => {
  const url =
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?t=9` +
    `&w=${encodeURIComponent(keyword)}&format=json&n=${limit}&p=${page}`

  const res = await httpRequest(url, {
    method: 'GET',
    headers: { Referer: 'https://y.qq.com/', 'User-Agent': DEFAULT_UA, Accept: 'application/json' }
  })

  const body = asObj(unwrapJsonp(res.body))
  const list = asArr(asObj(asObj(body.data).singer).list)

  return list
    .map((item) =>
      build('tx', {
        artistId: str(item.singerMID) || str(item.singerID),
        name: str(item.singerName),
        picUrl: str(item.singerPic),
        songCount: num(item.songNum, 0) || undefined,
        albumCount: num(item.albumNum, 0) || undefined,
        raw: { singerMID: str(item.singerMID), singerID: num(item.singerID) }
      })
    )
    .filter((x): x is ArtistInfo => x !== null)
}

/** 网易云 —— type=100 表示搜歌手 */
const searchNetease: ArtistSearcher = async (keyword, page, limit) => {
  const offset = (page - 1) * limit
  const url =
    `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}` +
    `&type=100&offset=${offset}&limit=${limit}&total=true`

  const res = await httpRequest(url, {
    method: 'GET',
    headers: {
      Referer: 'https://music.163.com/',
      'User-Agent': DEFAULT_UA,
      Cookie: 'appver=2.0.2; os=pc',
      Accept: 'application/json'
    }
  })

  const body = asObj(res.body)
  const list = asArr(asObj(body.result).artists)

  return list
    .map((item) =>
      build('wy', {
        artistId: str(item.id),
        name: str(item.name),
        alias: asArr(item.alias).map((a) => str(a)).filter(Boolean).join(' / '),
        picUrl: str(item.picUrl),
        songCount: num(item.musicSize, 0) || undefined,
        albumCount: num(item.albumSize, 0) || undefined,
        raw: { id: str(item.id) }
      })
    )
    .filter((x): x is ArtistInfo => x !== null)
}

/** 咪咕 —— searchSwitch 里指定只搜歌手，结果在 singerResultData.result */
const searchMigu: ArtistSearcher = async (keyword, page, limit) => {
  const searchSwitch = encodeURIComponent(JSON.stringify({ singer: 1 }))
  const url =
    `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?text=${encodeURIComponent(keyword)}` +
    `&pageNo=${page}&pageSize=${limit}&isCopyright=1&searchSwitch=${searchSwitch}`

  const res = await httpRequest(url, {
    method: 'GET',
    headers: { Referer: 'https://app.c.nf.migu.cn/', 'User-Agent': DEFAULT_UA, Accept: 'application/json' }
  })

  const body = asObj(res.body)
  const data = asObj(body.singerResultData)

  return asArr(data.result)
    .map((item) => {
      const images = asArr(item.imgItems)
      return build('mg', {
        artistId: str(item.id),
        name: str(item.name) || str(item.singerName),
        picUrl: str(item.picUrl) || str(images[0]?.img),
        raw: { id: str(item.id) }
      })
    })
    .filter((x): x is ArtistInfo => x !== null)
}

/** 平台 → 搜索器 */
export const artistSearchers: Record<string, ArtistSearcher> = {
  kw: searchKuwo,
  kg: searchKugou,
  tx: searchQQ,
  wy: searchNetease,
  mg: searchMigu
}

/** 平台展示名，用于错误提示 */
export const ARTIST_PLATFORM_NAMES: Record<string, string> = {
  kw: '酷我音乐',
  kg: '酷狗音乐',
  tx: 'QQ音乐',
  wy: '网易云音乐',
  mg: '咪咕音乐'
}
