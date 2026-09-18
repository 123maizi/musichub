/**
 * 内置歌词服务
 *
 * 为什么需要它 —— 这是一个被实测推翻的假设：
 *
 * 原本歌词完全依赖音源脚本的 `lyric` action。但实测发现，声明支持歌词的音源
 * （酷我那两个）实际调不通，于是「有歌可听」被「音源还愿意给歌词」绑架了。
 *
 * 而歌词本身是**跨平台通用**的：同一首歌在哪个平台播放，歌词都是那一份。
 * 所以这里用一个稳定的公开接口兜底，与音源解耦。
 */
import type { Lyric, Song } from '@shared/types/music'
import { httpRequest } from '../net/http'

const NETEASE_HEADERS = {
  Referer: 'https://music.163.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Cookie: 'appver=2.0.2; os=pc',
  Accept: 'application/json'
}

/** 歌词来源标识，便于界面与日志区分「音源给的」还是「内置兜底的」 */
export const BUILTIN_LYRIC_SOURCE = 'builtin:netease'

/** 搜索找到最匹配的歌曲 id */
async function findSongId(song: Song): Promise<string | null> {
  // 带上第一位歌手，命中率明显高于只用歌名
  const primarySinger = song.singer.split(/[/、,，]/)[0]?.trim() ?? ''
  const keyword = `${song.name} ${primarySinger}`.trim()

  const url =
    `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}` +
    `&type=1&offset=0&limit=5&total=true`

  const res = await httpRequest(url, {
    method: 'GET',
    headers: NETEASE_HEADERS,
    timeout: 10000
  })

  const body = (res.body ?? {}) as Record<string, unknown>
  const result = (body.result ?? {}) as Record<string, unknown>
  const list = Array.isArray(result.songs) ? (result.songs as Record<string, unknown>[]) : []
  if (list.length === 0) return null

  // 优先选择歌名完全一致的，避免拿到翻唱或同名曲
  const target = song.name.trim()
  const exact = list.find((item) => String(item.name ?? '').trim() === target)
  const picked = exact ?? list[0]
  const id = picked?.id
  return id === undefined || id === null ? null : String(id)
}

/** 按 id 拉歌词 */
async function fetchById(id: string): Promise<Lyric | null> {
  const url = `https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=1&kv=1&tv=-1`
  const res = await httpRequest(url, {
    method: 'GET',
    headers: NETEASE_HEADERS,
    timeout: 10000
  })

  const body = (res.body ?? {}) as Record<string, unknown>
  const lrc = (body.lrc ?? {}) as Record<string, unknown>
  const tlyric = (body.tlyric ?? {}) as Record<string, unknown>

  const lyric = typeof lrc.lyric === 'string' ? lrc.lyric : ''
  const translated = typeof tlyric.lyric === 'string' ? tlyric.lyric : ''

  // 有些歌返回的是纯文本占位（如 "纯音乐，请欣赏"），照样算有效歌词
  if (!lyric.trim()) return null

  return {
    lyric,
    tlyric: translated,
    sourceId: BUILTIN_LYRIC_SOURCE
  }
}

/**
 * 取歌词。
 * 歌词失败绝不该影响播放，所以这里全程吞异常，最差就是返回 null。
 */
export async function fetchBuiltinLyric(song: Song): Promise<Lyric | null> {
  try {
    const id = await findSongId(song)
    if (!id) return null
    return await fetchById(id)
  } catch {
    return null
  }
}
