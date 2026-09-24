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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

/**
 * 去 QQ 音乐搜一张封面。
 *
 * 用的是 search_for_qq_cp，**不是** client_search_cp ——
 * 后者现在一律返回 500，补图功能就是因此彻底失效的
 * （表现为「一大堆歌没有封面」，而且多半是酷我这种本来就缺封面的源）。
 * 换到这个路径后恢复正常。
 */
async function searchCoverFromQq(song: Song): Promise<string | null> {
  // 带上第一位歌手，命中率明显高于只用歌名
  const primarySinger = song.singer.split(/[/、,，&]/)[0]?.trim() ?? ''
  const keyword = `${song.name} ${primarySinger}`.trim()
  if (!keyword) return null

  const url =
    `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=1&n=3` +
    `&w=${encodeURIComponent(keyword)}&format=json&cr=1`

  const res = await httpRequest(url, { method: 'GET', headers: QQ_HEADERS, timeout: 8000 })
  const body = asObj(unwrapJsonp(res.body))
  const list = asArr(asObj(asObj(body.data).song).list)
  if (list.length === 0) return null

  // 必须歌名与歌手都对得上，否则宁可不要（详见 pickBestMatch 的说明）
  const picked = pickBestMatch(
    list,
    song,
    (item) => str(item.title) || str(item.songname),
    (item) => asArr(item.singer).map((s) => str(s.name)).join('/')
  )
  if (!picked) return null

  const albumMid = str(asObj(picked.album).mid) || str(picked.albummid)
  if (!albumMid) return null

  return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
}

/**
 * 去酷狗搜一张封面。
 *
 * 为什么要有这个第二来源：实测发现酷我自己的搜索结果里，很多条目
 * ALBUMID=0、封面字段是空的（搜「周杰伦」20 条只有 1 条带封面），
 * 这种只能跨平台补。而酷狗的封面又准又全（换用正确的 union_cover
 * 字段后实测四个关键词各 6/6），中文歌的命中率尤其好。
 */
async function searchCoverFromKugou(song: Song): Promise<string | null> {
  const primarySinger = song.singer.split(/[/、,，&]/)[0]?.trim() ?? ''
  const keyword = `${song.name} ${primarySinger}`.trim()
  if (!keyword) return null

  const url =
    `http://mobilecdn.kugou.com/api/v3/search/song?format=json` +
    `&keyword=${encodeURIComponent(keyword)}&page=1&pagesize=3&showtype=1`

  const res = await httpRequest(url, {
    method: 'GET',
    headers: { 'User-Agent': DEFAULT_UA },
    timeout: 8000
  })
  const list = asArr(asObj(asObj(res.body).data).info)
  if (list.length === 0) return null

  // 同样要求歌名与歌手都对得上
  const picked = pickBestMatch(
    list,
    song,
    (item) => str(item.songname),
    (item) => str(item.singername)
  )
  if (!picked) return null

  return kugouCoverFromItem(picked)
}

/** 归一化：忽略大小写与空白，用于歌名/歌手比对 */
function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

/**
 * 从搜索结果里挑一个「配得上」的候选。
 *
 * 这里的教训很直接：**只看歌名会导致张冠李戴**。
 * 实测给「蜗牛 - 周杰伦」补图时，只按歌名匹配挑中了
 * 「天使童声合唱团」那张专辑封面 —— 用户拿到的是一张完全无关的图。
 * 错误的封面比没有封面更糟：它是假数据，会让人以为这首歌真属于那张专辑。
 *
 * 所以改成打分制，并且**宁可返回 null 也不硬凑**：
 *   · 歌名完全一致  → 2 分
 *   · 歌手对得上    → 2 分
 *   · 歌名互相包含  → 1 分
 * 满分为 4；低于 3 分（比如只对了歌名、歌手完全不符）直接放弃。
 */
function pickBestMatch(
  list: Json[],
  song: Song,
  getName: (item: Json) => string,
  getSinger: (item: Json) => string
): Json | null {
  const wantName = norm(song.name)
  const wantSinger = norm(song.singer.split(/[/、,，&]/)[0] ?? '')

  let best: Json | null = null
  let bestScore = 0

  for (const item of list) {
    const name = norm(getName(item))
    const singer = norm(getSinger(item))
    if (!name) continue

    let score = 0
    if (name === wantName) score += 2
    else if (name.includes(wantName) || wantName.includes(name)) score += 1

    if (wantSinger && singer) {
      if (singer.includes(wantSinger) || wantSinger.includes(singer)) score += 2
    }

    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }

  // 3 分起步：至少「歌名完全一致 + 歌手对得上」，或「歌名一致 + 歌手部分一致」
  return bestScore >= 3 ? best : null
}

/** 从酷狗搜索结果里取封面地址。 */
export function kugouCoverFromItem(item: Json): string | null {
  const raw = item.trans_param
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const cover = asObj(parsed).union_cover
    if (typeof cover !== 'string' || !cover) return null
    // 地址里带 {size} 占位符，要替换成具体尺寸
    return cover.replace('{size}', '300')
  } catch {
    return null
  }
}

/**
 * 解析一首歌的封面。
 * 取不到就返回 null，交给界面显示占位图标 —— 绝不返回假图。
 *
 * 两个来源依次尝试：QQ 优先，酷狗兜底。多一次请求换来的是
 * 「几乎不再有歌没有封面」，这个代价值得 —— 而且结果会进缓存，
 * 同一首歌只会走这一次。
 */
export async function resolveCover(song: Song): Promise<string | null> {
  const key = cacheKey(song)
  if (cache.has(key)) return cache.get(key) ?? null

  let url: string | null = null
  for (const search of [searchCoverFromQq, searchCoverFromKugou]) {
    try {
      url = await search(song)
      if (url) break
    } catch {
      // 单个来源失败就换下一个，补图本来就是尽力而为
      url = null
    }
  }

  if (cache.size >= CACHE_LIMIT) {
    // 半量清理：比全清温和，也不会让 Map 无限增长
    for (const oldKey of [...cache.keys()].slice(0, CACHE_LIMIT / 2)) cache.delete(oldKey)
  }
  cache.set(key, url)
  return url
}

/** 判断一段字节是不是图片（决定要不要写进文件） */
function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png'
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (buf.toString('latin1', 0, 3) === 'GIF') return 'gif'
  return null
}

/**
 * 把尺寸段换成更大的。
 *
 * 列表里用的小图只有一两百像素，直接存下来当封面太糊
 * （实测酷我那张 120px 只有 2.7KB）。下载封面时统一要到最大档：
 *   · 酷我  /star/albumcover/120/…  → 1000（实测 263KB）
 *   · 酷狗  imge.kugou.com/stdmusic/240/… → 1000（实测 277KB）
 *   · QQ    T002R300x300M000… → T002R500x500M000…
 */
function upscaleCoverUrl(url: string): string {
  if (url.includes('/star/albumcover/')) {
    return url.replace(/(\/star\/albumcover\/)\d+(\/)/, '$11000$2')
  }
  if (url.includes('imge.kugou.com/stdmusic/')) {
    return url.replace(/(imge\.kugou\.com\/stdmusic\/)\d+(\/)/, '$11000$2')
  }
  if (url.includes('y.gtimg.cn/music/photo_new/T002R')) {
    return url.replace(/T002R\d+x\d+M000/, 'T002R500x500M000')
  }
  return url
}

/**
 * 把一首歌的封面下载到本地。
 *
 * 顺序：先用平台给的封面，没有就跨平台补一张。
 * 拿到字节后**必须校验是不是真图片** —— 直接写文件的话，
 * 万一地址返回的是一个 HTML 错误页，用户就会得到一个「后缀是 jpg、
 * 打开是乱码」的文件，那正是我们一直在避免的问题。
 */
export async function downloadCoverTo(
  song: Song,
  dir: string,
  baseName: string
): Promise<{ path: string; bytes: number; from: 'platform' | 'resolved' }> {
  let url = song.picUrl?.trim() || ''
  let from: 'platform' | 'resolved' = 'platform'

  if (!url) {
    const resolved = await resolveCover(song)
    if (!resolved) throw new Error('这首歌没有找到可用封面')
    url = resolved
    from = 'resolved'
  }

  // 要最大尺寸的，别把列表缩略图当封面存下来
  url = upscaleCoverUrl(url)

  const res = await httpRequest(url, {
    method: 'GET',
    headers: { 'User-Agent': DEFAULT_UA, Referer: new URL(url).origin + '/' },
    timeout: 15000,
    binary: true
  })
  const buf = res.raw
  if (!buf || buf.length === 0) throw new Error('封面地址没有返回内容')

  const ext = sniffImage(buf)
  if (!ext) {
    throw new Error('这个地址返回的不是图片，可能已失效 —— 换一首或稍后再试')
  }

  const safe = baseName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'cover'
  const target = join(dir, `${safe}.${ext}`)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(target, buf)

  return { path: target, bytes: buf.length, from }
}
