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

/**
 * 单次补图的总时间预算。
 *
 * 为什么要有预算：一次补图最多会打 2 个关键词 × 2 个来源 = 4 次请求，
 * 每处 6 秒超时的话最坏要 24 秒 —— 渲染层那边的并发闸门会被长时间占住，
 * 列表看起来就是「一直在转圈」。这里给出总预算，超了就收工。
 */
const RESOLVE_BUDGET_MS = 12000

/** 单次上游请求的超时上限 */
const SOURCE_TIMEOUT_MS = 6000

/** 候选得分门槛：满分 4（歌名 2 + 歌手 2），低于 3 一律视为「配不上」 */
const MIN_SCORE = 3

/**
 * 清词重试那一轮用更高的门槛（4 分 = 歌名完全一致 + 歌手对得上）。
 *
 * 原因：清词会把「稻香 (完整版|DJ Ray版)」变成「稻香」—— 名字是我们自己改写的。
 * 这一轮如果再允许「互相包含」，等于拿改写过的名字去放宽匹配范围，更容易挂错图。
 * 所以只接受「歌名完全一致 + 歌手对得上」。
 *
 * 代价是少数确实搜不到的变体仍然显示占位图标 —— 这是刻意的取舍：
 * 宁可占位，也不挂一张不属于这首歌的封面。
 */
const MIN_SCORE_CLEAN = 4

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

/**
 * 缓存：封面基本不变，而且补一张要走一次网络搜索。
 *
 * 关键区别对待「成功」与「失败」：
 *   · 成功 —— 封面几乎不变，长期缓存
 *   · 失败 —— 只缓存很短一段时间。原来失败也是长期缓存，
 *     于是某一次网络抖动会让这首歌在整个会话里再也补不上图，
 *     用户看到的就是「有些封面死活加载不出来」。短 TTL 既挡住
 *     同一页面的重复请求，又给了「过一会儿自己好」的机会。
 */
interface CoverCacheEntry {
  url: string | null
  at: number
}

const cache = new Map<string, CoverCacheEntry>()
const CACHE_LIMIT = 2000

/**
 * 负结果（没补到）的缓存时长。
 *
 * 必须比渲染层 CoverImage 的自愈重试间隔（30 秒）短，否则那次重试会被
 * 这里的负缓存直接挡回去、等于没重试。20 秒足够挡住「同一屏重复挂载」
 * 造成的重复请求，又不至于让一次抖动变成永久失败。
 */
const FAIL_TTL_MS = 20_000

function cacheKey(song: Song): string {
  return `${song.name}|${song.singer}`.trim().toLowerCase()
}

/** 读缓存；失败结果过期就当作没有缓存 */
function readCache(key: string): { hit: boolean; url: string | null } {
  const entry = cache.get(key)
  if (!entry) return { hit: false, url: null }
  if (entry.url) return { hit: true, url: entry.url }
  if (Date.now() - entry.at < FAIL_TTL_MS) return { hit: true, url: null }
  cache.delete(key)
  return { hit: false, url: null }
}

/** 写缓存，超上限时半量淘汰（比全清温和） */
function writeCache(key: string, url: string | null): void {
  if (cache.size >= CACHE_LIMIT) {
    for (const oldKey of [...cache.keys()].slice(0, Math.floor(CACHE_LIMIT / 2))) cache.delete(oldKey)
  }
  cache.set(key, { url, at: Date.now() })
}

/** 归一化：忽略大小写与空白，用于歌名/歌手比对 */
function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

/**
 * 去掉歌名里的括号后缀：「稻香 (完整版|DJ Ray版)」→「稻香」。
 *
 * 为什么需要：各平台的搜索结果里，同一首歌会有大量「(Live)」「(片段)」「(DJ版)」
 * 变体，带着后缀去搜经常只能命中这些变体，而它们往往没有封面字段。
 * 实测「烟花易冷 (片段)」：QQ 用全名搜最高只有 2 分（候选全是「xx秒片段」），
 * 用「烟花易冷」重搜才稳定命中「烟花易冷 - 周杰伦」；「淘汰 (2007上海演唱会)」
 * 也是靠清词重搜在酷狗拿到的封面。
 */
function stripDecorations(name: string): string {
  return name
    .replace(/[（(【[][^）)】\]]*[）)】\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 取第一位歌手：多歌手用 / 、 , ，& 分隔 */
function primarySingerOf(song: Song): string {
  return song.singer.split(/[/、,，&]/)[0]?.trim() ?? ''
}

/** 打分候选：分数 + 封面地址（可能为空，字段缺失在平台侧很常见） */
interface ScoredCandidate {
  score: number
  cover: string | null
  name: string
  singer: string
}

/**
 * 给搜索结果打分并排序，**但不做取舍**。
 *
 * 取舍交给 pickCover —— 这里只负责回答「每个候值得几分、有没有封面」。
 *
 * 打分规则的教训很直接（见 pickCover 的说明）：只看歌名会导致张冠李戴。
 *   · 歌名完全一致  → 2 分
 *   · 歌名互相包含  → 1 分
 *   · 歌手对得上    → 2 分
 * 满分 4。
 */
function rankCandidates(
  list: Json[],
  wantName: string,
  wantSinger: string,
  getName: (item: Json) => string,
  getSinger: (item: Json) => string,
  getCover: (item: Json) => string | null
): ScoredCandidate[] {
  const name0 = norm(wantName)
  const singer0 = norm(wantSinger)
  const out: ScoredCandidate[] = []

  for (const item of list) {
    const name = norm(getName(item))
    const singer = norm(getSinger(item))
    if (!name) continue

    let score = 0
    if (name === name0) score += 2
    else if (name.includes(name0) || name0.includes(name)) score += 1

    if (singer0 && singer) {
      if (singer.includes(singer0) || singer0.includes(singer)) score += 2
    }

    out.push({ score, cover: getCover(item), name: getName(item), singer: getSinger(item) })
  }

  // 同分保持平台原始顺序，结果才可复现
  return out.sort((a, b) => b.score - a.score)
}

/**
 * 从打分结果里挑出第一个**可用**的封面。
 *
 * 三个关键点：
 *  1. `minScore` 门槛不能破 —— 分数不够的候选宁可不要，绝不挂错图。
 *  2. 分数够的候选要**逐个试**，而不是只看最高分那一个。
 *     实测：搜「稻香 (完整版|DJ Ray版)」时酷狗第 1 名「稻香」有 3 分但
 *     trans_param 里没有 union_cover，第 2 名同样 3 分却带封面 ——
 *     只看最高分就会把这一整条来源判死，这正是「某些封面死活加载不出来」的主因。
 *  3. 同分时优先**真专辑封面**：酷狗有些条目的 union_cover 是歌手头像
 *     （singerimg.kugou.com/uploadpic/softhead/），拿它当专辑封面会显得张冠李戴，
 *     所以只作为最后手段。
 */
function pickCover(candidates: ScoredCandidate[], minScore: number): string | null {
  const usable = candidates.filter((c) => c.score >= minScore && c.cover)
  if (usable.length === 0) return null
  const realAlbum = usable.find((c) => !isArtistHeadCover(c.cover as string))
  return (realAlbum ?? usable[0]).cover
}

/** 酷狗的歌手头像（不是专辑封面），只在没有别的选择时才用 */
function isArtistHeadCover(url: string): boolean {
  return url.includes('singerimg.kugou.com/uploadpic/softhead/')
}

/** 一次上游搜索的上下文：关键词、参与打分用的歌名、剩余时间预算 */
interface SearchRound {
  keyword: string
  wantName: string
  minScore: number
}

/**
 * 去 QQ 音乐搜一张封面。
 *
 * 用的是 search_for_qq_cp，**不是** client_search_cp ——
 * 后者现在一律返回 500，补图功能就是因此彻底失效的
 * （表现为「一大堆歌没有封面」，而且多半是酷我这种本来就缺封面的源）。
 * 换到这个路径后恢复正常。
 *
 * n=5：平台返回的排序并不稳定（实测同一个关键词两次调用，第 1 名和第 4 名会互换），
 * 只取 3 条经常拿不到带封面字段的那一条。
 */
async function searchCoverFromQq(round: SearchRound, song: Song, budgetMs: number): Promise<string | null> {
  if (!round.keyword) return null

  const url =
    `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=1&n=5` +
    `&w=${encodeURIComponent(round.keyword)}&format=json&cr=1`

  const res = await httpRequest(url, {
    method: 'GET',
    headers: QQ_HEADERS,
    timeout: Math.min(SOURCE_TIMEOUT_MS, budgetMs)
  })
  const body = asObj(unwrapJsonp(res.body))
  const list = asArr(asObj(asObj(body.data).song).list)
  if (list.length === 0) return null

  const candidates = rankCandidates(
    list,
    round.wantName,
    primarySingerOf(song),
    (item) => str(item.title) || str(item.songname),
    (item) => asArr(item.singer).map((s) => str(s.name)).join('/'),
    (item) => {
      const albumMid = str(asObj(item.album).mid) || str(item.albummid)
      return albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : null
    }
  )

  return pickCover(candidates, round.minScore)
}

/**
 * 去酷狗搜一张封面。
 *
 * 为什么要有这个第二来源：实测发现酷我自己的搜索结果里，很多条目
 * ALBUMID=0、封面字段是空的（搜「周杰伦」20 条只有 1 条带封面），
 * 这种只能跨平台补。而酷狗的封面又准又全（换用正确的 union_cover
 * 字段后实测四个关键词各 6/6），中文歌的命中率尤其好。
 *
 * pagesize=5 的理由与 QQ 的 n=5 相同：实测 pagesize=3 时「烟花易冷 (片段)」
 * 只能搜到三个「xx片段」变体（最高 2 分，配不上），放宽到 5 条才出现
 * 真正带封面的「烟花易冷 - 周杰伦」。
 */
async function searchCoverFromKugou(round: SearchRound, song: Song, budgetMs: number): Promise<string | null> {
  if (!round.keyword) return null

  const url =
    `http://mobilecdn.kugou.com/api/v3/search/song?format=json` +
    `&keyword=${encodeURIComponent(round.keyword)}&page=1&pagesize=5&showtype=1`

  const res = await httpRequest(url, {
    method: 'GET',
    headers: { 'User-Agent': DEFAULT_UA },
    timeout: Math.min(SOURCE_TIMEOUT_MS, budgetMs)
  })
  const list = asArr(asObj(asObj(res.body).data).info)
  if (list.length === 0) return null

  const candidates = rankCandidates(
    list,
    round.wantName,
    primarySingerOf(song),
    (item) => str(item.songname),
    (item) => str(item.singername),
    (item) => kugouCoverFromItem(item)
  )

  return pickCover(candidates, round.minScore)
}

/**
 * 构造依次尝试的搜索轮次。
 *
 * 第 1 轮用平台给的完整歌名（与历史行为一致，门槛 3 分）；
 * 第 2 轮只在第 1 轮颗粒无收时启动，用去掉括号后缀的名字重搜，
 * 并且门槛提到 4 分（歌名完全一致 + 歌手对得上）——
 * 名字是我们自己改写的，这一轮必须更严，避免为了补图而放宽匹配。
 */
function buildRounds(song: Song): SearchRound[] {
  const full = song.name.trim()
  if (!full) return []
  const singer = primarySingerOf(song)
  const rounds: SearchRound[] = [
    { keyword: `${full} ${singer}`.trim(), wantName: full, minScore: MIN_SCORE }
  ]

  const base = stripDecorations(full)
  if (base && norm(base) !== norm(full)) {
    rounds.push({
      keyword: `${base} ${singer}`.trim(),
      wantName: base,
      minScore: MIN_SCORE_CLEAN
    })
  }
  return rounds
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
 * 尝试顺序：歌名变体（完整名 → 去括号后缀） × 来源（QQ → 酷狗），
 * 整体受 RESOLVE_BUDGET_MS 预算约束，不会把渲染层的并发槽位长期占住。
 * 结果进缓存，同一首歌只走这一次（失败只短缓存，抖动过去还能再试）。
 */
export async function resolveCover(song: Song): Promise<string | null> {
  const key = cacheKey(song)
  const cached = readCache(key)
  if (cached.hit) return cached.url

  const rounds = buildRounds(song)
  const deadline = Date.now() + RESOLVE_BUDGET_MS
  const sources = [searchCoverFromQq, searchCoverFromKugou]

  let url: string | null = null
  outer: for (const round of rounds) {
    for (const search of sources) {
      const left = deadline - Date.now()
      if (left < 800) break outer
      try {
        url = await search(round, song, left)
      } catch {
        // 单个来源失败就换下一个，补图本来就是尽力而为
        url = null
      }
      if (url) break outer
    }
  }

  writeCache(key, url)
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
 * （实测酷我那张 120px 只有 6KB）。下载封面时统一要到最大档，
 * 下面每一档都是**实测**过的（HTTP 状态 + 真实像素 + 字节数）：
 *   · 酷我  /star/albumcover/120/…  → …/1000/…    120x120 6KB → 1000x1000 172KB
 *   · 酷狗  imge.kugou.com/stdmusic/240/… → …/1000/…  240x240 30KB → 1000x1000 283KB
 *   · QQ    T002R300x300M000… → T002R500x500M000…  300x300 33KB → 500x500 81KB
 *   · 网易云 …jpg?param=300y300 → 去掉 param（原图最大）  300x300 12KB → 1080x531 44KB
 *
 * 刻意不动咪咕：它的 …/resource/00/… 里的 00 不是尺寸段，
 * 换成 300/500 实测直接 404，换了反而把好图弄坏。
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
  // 网易云：param 是「要多大给多大」的缩放参数，去掉它拿原始尺寸
  if (url.includes('music.126.net')) {
    return url.replace(/([?&])param=\d+[xy]\d+&?/, (_m, sep: string) => (sep === '?' ? '?' : '&')).replace(/[?&]$/, '')
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
