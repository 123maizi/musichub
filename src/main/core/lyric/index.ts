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

  // 第一步：搜到 songmid
  const searchUrl =
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=3` +
    `&w=${encodeURIComponent(keyword)}&format=json&cr=1&new_json=1`

  const searchRes = await httpRequest(searchUrl, {
    method: 'GET',
    headers: { Referer: 'https://y.qq.com/', 'User-Agent': DEFAULT_UA, Accept: 'application/json' },
    timeout: 8000
  })

  const searchBody = asObj(unwrapJsonp(searchRes.body))
  const list = asArr(asObj(asObj(searchBody.data).song).list)
  if (list.length === 0) return null

  // 优先歌名完全一致的，避免把翻唱的歌词按到原唱头上
  const target = song.name.trim()
  const picked =
    list.find((item) => str(item.title || item.songname).trim() === target) ?? list[0]
  const mid = str(picked.mid) || str(picked.songmid)
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

  const target = song.name.trim()
  const picked = list.find((item) => str(item.name).trim() === target) ?? list[0]
  const id = str(picked.id)
  if (!id) return null

  const lyricRes = await httpRequest(
    `https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=1&kv=1&tv=-1`,
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
