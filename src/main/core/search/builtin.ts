/**
 * 内置搜索 Provider —— 五大平台的官方搜索接口客户端
 *
 * 为什么需要这一层：
 *   洛雪协议本身只做「取流」，搜索是宿主（lx-music-desktop）内置的能力。
 *   所以想要「搜得到」，就必须自己实现各平台的搜索接口。
 *
 * 每个 Provider 只做两件事：发请求、把平台私有结构映射成统一的 Song。
 * 接口随时可能变化，因此每个 Provider 都是独立可替换的单元，
 * 某一个失效不会影响其它平台。
 */
import { createHash } from 'node:crypto'
import type { PlatformId, Song } from '@shared/types/music'
import { httpRequest, DEFAULT_UA } from '../net/http'

/** 单个 Provider 的搜索结果 */
export interface ProviderSearchResult {
  songs: Song[]
  total?: number
  isEnd: boolean
}

/** 搜索 Provider 统一接口 */
export interface SearchProvider {
  id: string
  name: string
  platform: PlatformId
  /** 关闭开关：接口失效时可单独停用，不影响其它平台 */
  enabled: boolean
  search(keyword: string, page: number, limit: number): Promise<ProviderSearchResult>
}

/* ------------------------------------------------------------------ *
 * 通用取值工具（平台返回结构脏且不稳定，统一在这里收口）
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

/**
 * 解开被反斜杠转义的 Unicode 转义序列。
 *
 * 酷我的 r.s 接口把 `&` 写成 `\\\\u0026`（四个反斜杠＋u0026，实测如此），
 * 宽松解析把这段原样带了出来 —— 于是歌手名在界面上显示成
 * 「Ye (侃爷)\u0026Beyoncé\u0026Charlie Wilson」，而按这个名字去搜艺人当然搜不到。
 *
 * 为什么要用 `\\+` 而不是 `\\`：反斜杠的层数是接口自己决定的，
 * 今天四个、明天可能两个，统一按「一串反斜杠 + uXXXX」来处理，
 * 无论几层都能一次剥干净，也不会误伤普通文本里的单斜杠。
 */
function decodeUnicodeEscapes(input: string): string {
  if (!input.includes('\\')) return input
  return input.replace(/\\+u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  )
}

/** 清掉搜索结果里的高亮标签、HTML 实体与 Unicode 转义 */
function cleanText(input: string): string {
  return decodeUnicodeEscapes(input)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 宽松 JSON 解析。
 * 酷我的 r.s 接口返回的是 JS 对象字面量（key/值都用单引号），不是合法 JSON，
 * 直接 JSON.parse 必然失败 —— 这是该接口最容易踩的坑。
 */
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

    // 字符串内部
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
    // 单引号字符串里出现的双引号需要转义
    if (quote === "'" && ch === '"') {
      out += '\\"'
      i += 1
      continue
    }
    out += ch
    i += 1
  }

  // 容忍尾随逗号
  return JSON.parse(out.replace(/,\s*([}\]])/g, '$1')) as Json
}

/**
 * 把各种形态的「列表」容器统一成数组。
 * 各平台分页结构差异极大：数组 / 数字键对象 / 嵌套一层数组，这个函数全部兜住。
 */
function normalizeToArray(value: unknown): Json[] {
  if (Array.isArray(value)) {
    // 形如 [[{...}], [{...}]] 的嵌套，展开一层
    if (value.length > 0 && Array.isArray(value[0])) {
      return (value as unknown[][]).map((x) => unwrapItem(x)).filter(Boolean) as Json[]
    }
    return value as Json[]
  }
  if (value && typeof value === 'object') {
    // 形如 { "0": {...}, "1": {...}, length: n } 的形态
    const obj = value as Json
    const keys = Object.keys(obj).filter((k) => /^\d+$/.test(k))
    if (keys.length > 0) {
      keys.sort((a, b) => Number(a) - Number(b))
      return keys.map((k) => unwrapItem(obj[k])).filter(Boolean) as Json[]
    }
  }
  return []
}

/** 元素若被包在单元素数组里，取出里层对象 */
function unwrapItem(item: unknown): Json | null {
  if (Array.isArray(item)) {
    return item.length > 0 && item[0] && typeof item[0] === 'object' ? (item[0] as Json) : null
  }
  return item && typeof item === 'object' ? (item as Json) : null
}

/** 组装统一 Song */
function makeSong(
  platform: PlatformId,
  data: {
    songmid: string
    name: string
    singer: string
    albumName?: string
    albumId?: string | number
    duration?: number
    picUrl?: string
    hash?: string
    songId?: string | number
    raw?: Json
  }
): Song {
  return {
    id: `${platform}_${data.songmid}`,
    platform,
    songmid: data.songmid,
    hash: data.hash,
    songId: data.songId,
    name: cleanText(data.name) || '未知歌曲',
    singer: cleanText(data.singer) || '未知歌手',
    albumName: cleanText(data.albumName ?? ''),
    albumId: data.albumId,
    duration: data.duration ?? 0,
    picUrl: data.picUrl,
    // 真实可用音质由取流阶段按音源能力决定，这里先给常见集合
    qualities: ['128k', '320k', 'flac'],
    channel: 'builtin',
    providerId: platform,
    raw: data.raw
  }
}

/* ------------------------------------------------------------------ *
 * 酷我音乐
 * ------------------------------------------------------------------ */

const KUWO_HEADERS = {
  Referer: 'http://www.kuwo.cn/',
  'User-Agent': DEFAULT_UA,
  Cookie: 'kw_token=ABCDEFGHIJKLMNOP'
}

const kuwoProvider: SearchProvider = {
  id: 'kw',
  name: '酷我音乐',
  platform: 'kw',
  enabled: true,
  async search(keyword, page, limit) {
    // 移动端接口无需 csrf token，稳定性优于 www 接口
    const url =
      `http://search.kuwo.cn/r.s?all=${encodeURIComponent(keyword)}` +
      `&ft=music&itemset=web_2013&client=kt&pn=${page - 1}&rn=${limit}` +
      `&rformat=json&encoding=utf8`

    const res = await httpRequest(url, { method: 'GET', headers: KUWO_HEADERS })
    // 该接口返回单引号 JS 字面量而非合法 JSON，必须走宽松解析
    const body: Json =
      res.body && typeof res.body === 'object'
        ? (res.body as Json)
        : parseLooseJson(String(res.body ?? ''))
    const list = asArr(body.abslist)

    const songs = list.map((item) => {
      const rid = str(item.MUSICRID) // 形如 MUSIC_474678847
      // DC_TARGETID 是纯数字 id，最干净；缺失时退回 MUSICRID 去前缀
      const songmid = str(item.DC_TARGETID) || rid.replace(/^MUSIC_/, '') || str(item.rid)
      const picShort = str(item.web_albumpic_short)
      return makeSong('kw', {
        songmid,
        hash: songmid,
        name: str(item.SONGNAME),
        singer: str(item.ARTIST),
        albumName: str(item.ALBUM),
        albumId: str(item.ALBUMID),
        duration: num(item.DURATION),
        picUrl: picShort ? `https://img2.kuwo.cn/star/albumcover/${picShort}` : undefined,
        raw: {
          rid: songmid,
          MUSICRID: rid,
          DC_TARGETID: str(item.DC_TARGETID),
          ALBUMID: str(item.ALBUMID),
          web_albumpic_short: picShort
        }
      })
    })

    return {
      songs,
      total: num(body.TOTAL) || undefined,
      isEnd: list.length < limit
    }
  }
}

/* ------------------------------------------------------------------ *
 * 酷狗音乐
 * ------------------------------------------------------------------ */

/**
 * 酷狗封面地址。
 *
 * 之前这里直接写死 undefined，理由是「stdmusic 那套地址对任何专辑都返回
 * 同一张占位图」。那个结论其实是因为**取错了字段**：
 * 封面根本不在 album_id 里，而是藏在 trans_param 这个 JSON 字符串的
 * union_cover 字段里 —— 形如
 *   http://imge.kugou.com/stdmusic/{size}/20230920/20230920142503632013.jpg
 * 注意那个 {size} 占位符，得替换成具体尺寸才是一个完整地址
 * （实测 150/240/300/480/800/1000 都认）。
 *
 * 换上正确字段后，实测四个关键词各 6/6 全部拿到封面，
 * 且每首歌的地址都不同 —— 是真封面，不是统一占位图。
 */
function kugouCoverUrl(item: Json, size = 240): string | undefined {
  const raw = item.trans_param
  if (!raw) return undefined
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const cover = asObj(parsed).union_cover
    if (typeof cover !== 'string' || !cover) return undefined
    return cover.replace('{size}', String(size))
  } catch {
    // trans_param 偶有截断或非 JSON 的情况，拿不到就不给封面
    return undefined
  }
}

const kugouProvider: SearchProvider = {
  id: 'kg',
  name: '酷狗音乐',
  platform: 'kg',
  enabled: true,
  async search(keyword, page, limit) {
    const url =
      `http://mobilecdn.kugou.com/api/v3/search/song?format=json` +
      `&keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}&showtype=1`

    const res = await httpRequest(url, {
      method: 'GET',
      headers: { 'User-Agent': DEFAULT_UA }
    })
    const body = asObj(res.body)
    const data = asObj(body.data)
    const list = asArr(data.info)

    const songs = list.map((item) => {
      const hash = str(item.hash)
      const albumId = str(item.album_id)
      return makeSong('kg', {
        songmid: hash,
        hash,
        songId: str(item.audio_id),
        name: str(item.songname),
        singer: str(item.singername),
        albumName: str(item.album_name),
        albumId,
        duration: num(item.duration),
        picUrl: kugouCoverUrl(item),
        raw: {
          hash,
          sqhash: str(item.sqhash),
          '320hash': str(item['320hash']),
          audio_id: str(item.audio_id),
          album_id: albumId,
          album_audio_id: str(item.album_audio_id),
          privilege: num(item.privilege),
          filesize: num(item.filesize)
        }
      })
    })

    return {
      songs,
      total: num(data.total) || undefined,
      isEnd: list.length < limit
    }
  }
}

/* ------------------------------------------------------------------ *
 * QQ 音乐
 * ------------------------------------------------------------------ */

const qqProvider: SearchProvider = {
  id: 'tx',
  name: 'QQ音乐',
  platform: 'tx',
  enabled: true,
  async search(keyword, page, limit) {
    /**
     * 用的是 search_for_qq_cp，**不是** client_search_cp。
     *
     * 老路径 `client_search_cp` 现在一律返回 HTTP 500（连同 new_json/Referer
     * 的各种组合都试过），这也是 QQ 结果突然全没了的原因。
     * 换到 search_for_qq_cp 后恢复正常，而且**必须去掉 new_json=1** ——
     * 带 new_json 时它只给新格式字段、专辑信息是空的；
     * 不带才返回旧的完整字段：albumname / albummid / pubtime，
     * 封面和年份都靠它们。
     */
    const url =
      `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=${page}&n=${limit}` +
      `&w=${encodeURIComponent(keyword)}&format=json&cr=1`

    const res = await httpRequest(url, {
      method: 'GET',
      headers: {
        Referer: 'https://y.qq.com/',
        'User-Agent': DEFAULT_UA,
        Accept: 'application/json'
      }
    })

    // QQ 接口有时返回 JSONP 包裹，这里做一次剥离
    const body = unwrapJsonp(res.body)
    const data = asObj(asObj(body).data)
    const songNode = asObj(data.song)
    const list = asArr(songNode.list)

    const songs = list.map((item) => {
      const singers = asArr(item.singer)
        .map((s) => str(s.name))
        .filter(Boolean)
        .join('/')
      const album = asObj(item.album)
      // 新老两种字段名都兜住：老接口给 albummid，新接口给 album.mid
      const albumMid = str(album.mid) || str(item.albummid)
      const albumName = str(album.name) || str(item.albumname)
      const songmid = str(item.mid) || str(item.songmid)
      // pubtime 是秒级时间戳，转成年份写进标签
      const pubtime = num(item.pubtime)

      return makeSong('tx', {
        songmid,
        songId: num(item.id) || undefined,
        name: str(item.title) || str(item.songname),
        singer: singers,
        albumName,
        albumId: albumMid,
        duration: num(item.interval),
        picUrl: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : undefined,
        raw: {
          songmid,
          songId: num(item.id),
          albumMid,
          albumname: albumName,
          pubtime: pubtime > 0 ? pubtime : undefined,
          size320: num(item.size320),
          sizeflac: num(item.sizeflac),
          media_mid: str(item.file?.media_mid),
          strMediaMid: str(item.file?.media_mid),
          type: num(item.type),
          pay: asObj(item.pay)
        }
      })
    })

    return {
      songs,
      total: num(songNode.totalnum) || undefined,
      isEnd: list.length < limit
    }
  }
}

/** 剥离 JSONP / callback 包裹 */
function unwrapJsonp(body: unknown): unknown {
  if (typeof body !== 'string') return body
  const trimmed = body.trim()
  const m = /^[\w$.]+\s*\(([\s\S]*)\)\s*;?$/.exec(trimmed)
  if (!m) return body
  try {
    return JSON.parse(m[1])
  } catch {
    return body
  }
}

/* ------------------------------------------------------------------ *
 * 网易云音乐
 * ------------------------------------------------------------------ */

/** 网易 CDN 封面密钥（平台固定公开串） */
const NETEASE_MAGIC = '3go8&$8*3*3h0k(2)2'

/**
 * 把网易的 picId 转成可直接访问的封面地址。
 * 网易不允许拿着 picId 直接取图，必须先做一次「逐字节异或 + md5 取 base64」
 * 再把结果拼进 CDN 路径 —— 这是网易接口最容易漏掉的一步。
 */
function neteasePicUrl(picId: string, size = 300): string | undefined {
  if (!picId) return undefined

  const key = Buffer.alloc(picId.length)
  for (let i = 0; i < picId.length; i += 1) {
    key[i] = picId.charCodeAt(i) ^ NETEASE_MAGIC.charCodeAt(i % NETEASE_MAGIC.length)
  }

  const encrypted = createHash('md5')
    .update(key)
    .digest('base64')
    .replace(/\//g, '_')
    .replace(/\+/g, '-')

  return `https://p3.music.126.net/${encrypted}/${picId}.jpg?param=${size}y${size}`
}

const neteaseProvider: SearchProvider = {
  id: 'wy',
  name: '网易云音乐',
  platform: 'wy',
  enabled: true,
  async search(keyword, page, limit) {
    const offset = (page - 1) * limit
    const url = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(
      keyword
    )}&type=1&offset=${offset}&limit=${limit}&total=true`

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
    const result = asObj(body.result)
    const list = asArr(result.songs)

    const songs = list.map((item) => {
      const id = str(item.id)
      const artists = asArr(item.artists)
        .map((a) => str(a.name))
        .filter(Boolean)
        .join('/')
      const album = asObj(item.album)
      return makeSong('wy', {
        songmid: id,
        songId: id,
        name: str(item.name),
        singer: artists || str(asArr(item.ar)[0]?.name),
        albumName: str(album.name) || str(asObj(asArr(item.al)[0]).name),
        albumId: str(album.id) || str(asArr(item.al)[0]?.id),
        // 网易返回的 duration 是毫秒
        duration: Math.round(num(item.duration) / 1000),
        // 老接口把专辑放在 item.album，新接口放在 item.al —— 两个都试，否则封面会一直是空的
        picUrl:
          str(album.picUrl) ||
          str(asObj(asArr(item.al)[0]).picUrl) ||
          neteasePicUrl(str(album.picId) || str(asArr(item.al)[0]?.picId)),
        raw: {
          songmid: id,
          id,
          albumId: str(album.id),
          picId: str(album.picId),
          fee: num(item.fee),
          privilege: asObj(item.privilege)
        }
      })
    })

    return {
      songs,
      total: num(result.songCount) || undefined,
      isEnd: list.length < limit
    }
  }
}

/* ------------------------------------------------------------------ *
 * 咪咕音乐
 * ------------------------------------------------------------------ */

const miguProvider: SearchProvider = {
  id: 'mg',
  name: '咪咕音乐',
  platform: 'mg',
  enabled: true,
  async search(keyword, page, limit) {
    // 旧的 m.music.migu.cn/scr_search_tag 已改版为返回 HTML（反爬），
    // 改用 App 端 MIGUM2.0 接口，实测可用
    const searchSwitch = encodeURIComponent(JSON.stringify({ song: 1 }))
    const url =
      `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?text=${encodeURIComponent(
        keyword
      )}` + `&pageNo=${page}&pageSize=${limit}&isCopyright=1&sort=0&searchSwitch=${searchSwitch}`

    const res = await httpRequest(url, {
      method: 'GET',
      headers: {
        Referer: 'https://app.c.nf.migu.cn/',
        'User-Agent': DEFAULT_UA,
        Accept: 'application/json'
      }
    })

    const body = asObj(res.body)
    const data = asObj(body.songResultData)
    const list = normalizeToArray(data.resultList)

    const songs = list.map((item) => {
      const copyrightId = str(item.copyrightId)
      const numericId = str(item.id)
      // 咪咕取流以 copyrightId 为准（音源脚本普遍读这个字段）
      const songmid = copyrightId || numericId
      const singers = asArr(item.singers)
        .map((s) => str(s.name))
        .filter(Boolean)
        .join('/')
      const album = asObj(asArr(item.albums)[0])
      const imgItems = asArr(item.imgItems)
      const cover = imgItems.length > 0 ? str(imgItems[imgItems.length - 1].img) : ''

      return makeSong('mg', {
        songmid,
        songId: numericId,
        hash: copyrightId || songmid,
        name: str(item.name) || str(item.songName),
        singer: singers,
        albumName: str(album.name),
        albumId: str(album.id),
        duration: num(item.duration, 0),
        picUrl: cover || undefined,
        raw: {
          id: numericId,
          copyrightId,
          albumId: str(album.id),
          resourceType: str(item.resourceType),
          contentId: str(item.contentId),
          lyricUrl: str(item.lyricUrl)
        }
      })
    })

    return {
      songs,
      total: num(data.totalCount) || undefined,
      isEnd: list.length < limit
    }
  }
}

/** 内置 Provider 名录 */
export const builtinProviders: SearchProvider[] = [
  kuwoProvider,
  kugouProvider,
  qqProvider,
  neteaseProvider,
  miguProvider
]
