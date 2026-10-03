/**
 * 内置歌词服务
 *
 * 为什么需要它 —— 一个被实测推翻的假设：
 * 原本歌词完全依赖音源脚本的 lyric action。实测发现，声明支持歌词的音源
 * （酷我那两个）接口早已失效，于是「有歌可听」被「音源还愿意给歌词」绑架了。
 * 歌词本是**跨平台通用**的资源，所以这里自己动手，与音源彻底解耦。
 *
 * 数据源的选择同样来自实测：
 *   · QQ 音乐 —— 搜索稳定，歌词质量高（含作词 / 作曲 / 编曲信息）… 首选
 *   · 网易云  —— 搜索的 GET 接口限流严重（直接回「操作频繁，请稍候再试」），
 *                改用 POST 后可用，但结果常把翻唱排在原唱前面 … 备选
 */
import type { Lyric, Song } from '@shared/types/music'
import { hasVariantMark } from '@shared/purity'
import { httpRequest, DEFAULT_UA } from '../net/http'

const QQ_HEADERS = {
  Referer: 'https://y.qq.com/portal/player.html',
  'User-Agent': DEFAULT_UA,
  Accept: 'application/json'
}

const NETEASE_HEADERS = {
  Referer: 'https://music.163.com/',
  'User-Agent': DEFAULT_UA,
  Cookie: 'appver=2.0.2; os=pc',
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

/** 剥离 JSONP 包裹 */
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

/** 歌词里常带 HTML 实体，需要还原 */
function decodeEntities(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
}

/** 搜索关键词：带上第一位歌手，命中率明显更高 */
function buildKeyword(song: Song): string {
  const primarySinger = song.singer.split(/[/、,，]/)[0]?.trim() ?? ''
  return `${song.name} ${primarySinger}`.trim()
}

/* ------------------------------------------------------------------ *
 * 首选：QQ 音乐
 * ------------------------------------------------------------------ */

async function fetchFromQQ(song: Song): Promise<Lyric | null> {
  const keyword = buildKeyword(song)
  if (!keyword) return null

  /**
   * 第一步：搜到 songmid。
   *
   * 这里用的是 `search_for_qq_cp`，**不是** `client_search_cp` ——
   * 后者现在一律返回 HTTP 500（实测 0 字节、耗时 5.2 秒才失败），
   * 而它是歌词链路的**首选源**，也就是说每取一次歌词都要先在一个死接口上
   * 白等 5 秒，再退回网易云；两个平台都拿不到时就表现为「这首歌没有歌词」。
   * search_for_qq_cp 实测 161ms 返回；同样**必须去掉 new_json=1**
   * （带上它只给新格式字段，拿不到歌名用于比对）。
   */
  const searchUrl =
    `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=1&n=3` +
    `&w=${encodeURIComponent(keyword)}&format=json&cr=1`

  const searchRes = await httpRequest(searchUrl, {
    method: 'GET',
    headers: { Referer: 'https://y.qq.com/', 'User-Agent': DEFAULT_UA, Accept: 'application/json' },
    timeout: 6000
  })

  const searchBody = asObj(unwrapJsonp(searchRes.body))
  const list = asArr(asObj(asObj(searchBody.data).song).list)
  if (list.length === 0) return null

  // 歌名+歌手双重匹配，避免把翻唱版本的歌词挂到原唱头上
  const picked = pickBestSongItem(list, song.name, song.singer)
  const mid = str(picked?.mid) || str(picked?.songmid)
  if (!mid) return null

  // 第二步：取歌词（nobase64=1 让接口直接返回明文）
  const lyricUrl =
    `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(mid)}` +
    `&format=json&nobase64=1&g_tk=5381&loginUin=0&hostUin=0` +
    `&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`

  const lyricRes = await httpRequest(lyricUrl, {
    method: 'GET',
    headers: QQ_HEADERS,
    timeout: 8000
  })

  const body = asObj(unwrapJsonp(lyricRes.body))
  if (Number(body.retcode ?? 0) !== 0) return null

  const lyric = decodeEntities(str(body.lyric))
  const trans = decodeEntities(str(body.trans))

  if (!lyric.trim()) return null
  return { lyric, tlyric: trans || undefined, sourceId: 'builtin:qq' }
}

/* ------------------------------------------------------------------ *
 * 备选：网易云
 * ------------------------------------------------------------------ */

/**
 * 从候选里挑出「确实是这首歌」的那一条；挑不出匹配的就返回 undefined。
 *
 * 为什么必须带歌手一起匹配 —— 这在中文歌上是个实打实的坑：
 * 周杰伦的版权已从网易云下架，于是搜「晴天 周杰伦」返回的前五条**全是翻唱/AI 版本**
 * （「晴天(深情版) - Lucky小爱」「晴天 - Jay」…），没有一条是本人。
 * 只按歌名匹配的话会心安理得地选中翻唱，然后把**翻唱版自己的歌词**
 * 当成原曲歌词显示 —— 实测「晴天」会显示「你坐在窗边看云走散」
 * （真正的晴天开头是「故事的小黄花」）、「稻香」会显示「钟摆敲碎三更霜」。
 * 这比没有歌词更糟：用户会以为自己记错了歌词。
 *
 * 所以：歌名和歌手必须同时对得上才认。宁可不显示歌词，也不显示别人的歌词。
 * 唯一的例外是候选方没给歌手字段（个别接口会缺），那种情况只能退回按歌名匹配。
 */
function pickBestSongItem(
  list: Record<string, unknown>[],
  targetName: string,
  singer: string
): Record<string, unknown> | undefined {
  if (list.length === 0) return undefined
  const name = targetName.trim()
  const primary = singer.split(/[/、,，]/)[0]?.trim() ?? ''

  const nameOf = (item: Record<string, unknown>): string =>
    str(item.name ?? item.title ?? item.songname).trim()
  const artistsOf = (item: Record<string, unknown>): string => {
    const arr = item.artists ?? item.singer
    if (Array.isArray(arr)) {
      return arr.map((a) => str((a as Record<string, unknown>)?.name)).join('/')
    }
    return str(arr)
  }
  const nameMatches = (item: Record<string, unknown>): boolean => {
    const got = nameOf(item)
    return got === name || got.includes(name) || name.includes(got)
  }
  const singerMatches = (item: Record<string, unknown>): boolean => {
    const got = artistsOf(item)
    if (!got.trim()) return true // 对方没给歌手，只能放行，否则永远匹配不上
    return primary ? got.includes(primary) : true
  }

  /**
   * 别拿改版（翻唱 / 深情版 / 治愈版 / 女声版 / Cover / AI）的歌词当成原曲歌词。
   *
   * 光靠歌手匹配挡不住 —— 实测「稻香(治愈版)」的歌手字段写的是
   * 「周杰伦./街道办GDC/欧阳耀莹.」，照样包含「周杰伦」，是拿名字蹭搜的。
   * 好在项目里已经有成熟的改版标记检测（shared/purity.ts），直接复用：
   * 用户找的是《晴天》，就不能把《晴天(深情版)》的歌词挂上去。
   */
  const wantVariant = hasVariantMark(targetName)
  const variantMatches = (item: Record<string, unknown>): boolean =>
    wantVariant || !hasVariantMark(nameOf(item))

  const strict = list.find(
    (item) => nameMatches(item) && singerMatches(item) && variantMatches(item)
  )
  if (strict) return strict
  // 一条都对不上 —— 返回 undefined，让上层判定为「这首没有歌词」，
  // 而不是随便挑一条把别人的歌词显示出来。
  return undefined
}

async function fetchFromNetease(song: Song): Promise<Lyric | null> {
  const keyword = buildKeyword(song)
  if (!keyword) return null

  // 注意用 POST：GET 那个接口已被限流，会直接返回「操作频繁」
  const searchRes = await httpRequest('https://music.163.com/api/search/get', {
    method: 'POST',
    headers: NETEASE_HEADERS,
    form: { s: keyword, type: '1', offset: '0', limit: '5' },
    timeout: 8000
  })

  const body = asObj(searchRes.body)
  const list = asArr(asObj(body.result).songs)
  if (list.length === 0) return null

  const picked = pickBestSongItem(list, song.name, song.singer)
  const id = str(picked?.id)
  if (!id) return null

  /**
   * 取歌词。
   *
   * 这里必须是 lv=-1 / kv=-1，**不能是 lv=1** ——
   * 实测（同一首歌、同一时刻）：
   *     lv=1&kv=1&tv=-1  → lrc.lyric 是空字符串
   *     lv=-1&kv=-1&tv=-1 → lrc.lyric 有 381 字
   * 接口对 lv=1 返回 200 且结构完整，只是歌词字段为空 —— 不报错、
   * 只是「这首歌没有歌词」，是那种最难查的静默失败。
   * 「晴天」这种超主流曲目都会中招，换成 -1 立刻正常。
   */
  const lyricRes = await httpRequest(
    `https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`,
    { method: 'GET', headers: NETEASE_HEADERS, timeout: 8000 }
  )

  const lyricBody = asObj(lyricRes.body)
  const lyric = str(asObj(lyricBody.lrc).lyric)
  const trans = str(asObj(lyricBody.tlyric).lyric)

  if (!lyric.trim()) return null
  return { lyric, tlyric: trans || undefined, sourceId: 'builtin:netease' }
}

/* ------------------------------------------------------------------ *
 * 对外入口
 * ------------------------------------------------------------------ */

/**
 * 取歌词。
 *
 * 歌词失败绝不该影响播放，所以全程吞异常，最差就是返回 null。
 * 两个源依次尝试：QQ 优先（稳、质量高），失败再退网易云。
 */
export async function fetchBuiltinLyric(song: Song): Promise<Lyric | null> {
  try {
    const byQQ = await fetchFromQQ(song)
    if (byQQ) return byQQ
  } catch {
    /* 换下一个源 */
  }

  try {
    return await fetchFromNetease(song)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * 官方翻译歌词：从各平台收集「本来就翻好的」译文
 * ------------------------------------------------------------------ */

/**
 * 一个来自平台的现成译文。
 *
 * 为什么要有这东西：用户以前只能靠本地 AI 翻译，每次都要等模型跑一遍，
 * 既慢又费算力。但 QQ 与网易云的歌词接口**本身就带官方翻译**（歌手/平台官方做的），
 * 质量通常还比机器翻译好。所以这里把它们收集起来，交给用户挑。
 */
export interface OfficialTranslation {
  /** 稳定标识（平台名），渲染层用它当选项 key */
  id: string
  /** 展示名，例如「官方翻译 · QQ音乐」 */
  label: string
  platform: string
  /** LRC 格式的译文（与主歌词逐行对齐） */
  tlyric: string
}

/** QQ 的官方翻译：一次请求同时拿到主歌词与翻译，这里只取翻译 */
async function translationFromQQ(song: Song): Promise<OfficialTranslation | null> {
  const keyword = buildKeyword(song)
  if (!keyword) return null

  const searchRes = await httpRequest(
    `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=1&n=3` +
      `&w=${encodeURIComponent(keyword)}&format=json&cr=1`,
    {
      method: 'GET',
      headers: { Referer: 'https://y.qq.com/', 'User-Agent': DEFAULT_UA, Accept: 'application/json' },
      timeout: 6000
    }
  )
  const list = asArr(asObj(asObj(asObj(unwrapJsonp(searchRes.body)).data).song).list)
  const picked = pickBestSongItem(list, song.name, song.singer)
  const mid = str(picked?.mid) || str(picked?.songmid)
  if (!mid) return null

  const lyricRes = await httpRequest(
    `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(mid)}` +
      `&format=json&nobase64=1&g_tk=5381&loginUin=0&hostUin=0` +
      `&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`,
    { method: 'GET', headers: QQ_HEADERS, timeout: 6000 }
  )
  const trans = decodeEntities(str(asObj(unwrapJsonp(lyricRes.body)).trans))
  if (!trans.trim()) return null
  return { id: 'qq', label: '官方翻译 · QQ音乐', platform: 'QQ音乐', tlyric: trans }
}

/** 网易云的官方翻译（tlyric） */
async function translationFromNetease(song: Song): Promise<OfficialTranslation | null> {
  const keyword = buildKeyword(song)
  if (!keyword) return null

  const searchRes = await httpRequest('https://music.163.com/api/search/get', {
    method: 'POST',
    headers: NETEASE_HEADERS,
    form: { s: keyword, type: '1', offset: '0', limit: '5' },
    timeout: 6000
  })
  const list = asArr(asObj(asObj(asObj(searchRes.body).result).songs))
  const picked = pickBestSongItem(list, song.name, song.singer)
  const id = str(picked?.id)
  if (!id) return null

  const lyricRes = await httpRequest(
    `https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`,
    { method: 'GET', headers: NETEASE_HEADERS, timeout: 6000 }
  )
  const trans = str(asObj(asObj(lyricRes.body).tlyric).lyric)
  if (!trans.trim()) return null
  return { id: 'netease', label: '官方翻译 · 网易云', platform: '网易云', tlyric: trans }
}

/**
 * 收集所有能拿到的官方翻译。
 *
 * 并发拉取、各自独立失败 —— 一个平台挂了不该影响另一个。
 * 顺序固定（QQ 在前），因为实测 QQ 的翻译质量与覆盖率都更好。
 */
export async function fetchOfficialTranslations(song: Song): Promise<OfficialTranslation[]> {
  const settled = await Promise.allSettled([translationFromQQ(song), translationFromNetease(song)])
  const out: OfficialTranslation[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) out.push(r.value)
  }
  return out
}
