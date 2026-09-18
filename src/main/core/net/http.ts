/**
 * 统一 HTTP 客户端
 *
 * 这是整个软件的网络出口，服务于三处：
 *  1. 音源脚本的 lx.request     —— 脚本不直连网络，一律由宿主代理
 *  2. 内置搜索层                 —— 各平台官方接口
 *  3. 流代理 / 下载器            —— 带 Referer / Cookie 的媒体拉取
 *
 * 基于 Node 内置 fetch（undici），零第三方依赖。
 */
import type { LxRequestOptions, LxResponse } from '../source/lx-protocol'
import { APP_CONST } from '@shared/constants'

/** 默认 UA：伪装成主流浏览器，避免被平台接口拒绝 */
export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/** 需要 Cookie 的平台默认 Referer 映射，供下载/代理补头用 */
export const PLATFORM_REFERER: Record<string, string> = {
  kw: 'https://www.kuwo.cn/',
  kg: 'https://www.kugou.com/',
  tx: 'https://y.qq.com/',
  wy: 'https://music.163.com/',
  mg: 'https://music.migu.cn/'
}

/** 文本解码：按 charset 选择对应解码器 */
function decodeText(raw: Buffer, contentType: string): string {
  const match = /charset=([\w-]+)/i.exec(contentType)
  const charset = (match?.[1] ?? 'utf-8').toLowerCase()
  if (charset === 'utf-8' || charset === 'utf8') return raw.toString('utf8')
  try {
    return new TextDecoder(charset).decode(raw)
  } catch {
    return raw.toString('utf8')
  }
}

/** 判断响应体是否应按 JSON 解析 */
function shouldParseJson(text: string, contentType: string): boolean {
  if (/json/i.test(contentType)) return true
  const head = text.trimStart().slice(0, 1)
  // 很多国内接口 content-type 是 text/html 却返回 JSON，这里做宽松识别
  return head === '{' || head === '['
}

/** 把 fetch 的 Headers 转成普通对象（set-cookie 保留数组） */
function headersToObject(headers: Headers): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  const setCookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []
  if (setCookies.length > 0) out['set-cookie'] = setCookies
  return out
}

/**
 * 执行一次 HTTP 请求，返回洛雪协议形态的响应。
 */
export async function httpRequest(url: string, options: LxRequestOptions = {}): Promise<LxResponse> {
  const method = (options.method ?? 'GET').toUpperCase()
  const headers = new Headers()

  if (!hasHeader(options.headers, 'user-agent')) headers.set('User-Agent', DEFAULT_UA)
  if (!hasHeader(options.headers, 'accept')) headers.set('Accept', '*/*')
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      if (value === undefined || value === null) continue
      try {
        headers.set(key, String(value))
      } catch {
        /* 非法头名直接跳过，不让脚本的脏数据打断请求 */
      }
    }
  }

  let body: string | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    if (options.form) {
      const usp = new URLSearchParams()
      for (const [k, v] of Object.entries(options.form)) usp.append(k, String(v))
      body = usp.toString()
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/x-www-form-urlencoded')
      }
    } else if (typeof options.body === 'string') {
      body = options.body
    } else if (options.body !== undefined && options.body !== null) {
      body = JSON.stringify(options.body)
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    }
  }

  const timeout = options.timeout ?? APP_CONST.fetchTimeout
  const signal = timeout > 0 ? AbortSignal.timeout(timeout) : undefined

  const response = await fetch(url, {
    method,
    headers,
    body,
    signal,
    redirect: options.follow_max === 0 ? 'manual' : 'follow',
    // 媒体地址常带自签证书/异常链，这里不额外放宽，保持安全默认
    credentials: 'omit'
  })

  const arrayBuffer = await response.arrayBuffer()
  const raw = Buffer.from(arrayBuffer)

  let parsed: unknown
  if (options.binary) {
    parsed = raw
  } else {
    const contentType = response.headers.get('content-type') ?? ''
    const text = decodeText(raw, contentType)
    if (options.json || shouldParseJson(text, contentType)) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    } else {
      parsed = text
    }
  }

  return {
    statusCode: response.status,
    statusMessage: response.statusText,
    headers: headersToObject(response.headers),
    body: parsed,
    raw,
    url: response.url || url
  }
}

function hasHeader(headers: Record<string, string> | undefined, name: string): boolean {
  if (!headers) return false
  const lower = name.toLowerCase()
  return Object.keys(headers).some((k) => k.toLowerCase() === lower)
}

/**
 * 拉取媒体流（下载 / 代理用），支持 Range 断点续传。
 * 与 httpRequest 的区别：返回原始 Response，交由调用方流式处理，不缓冲到内存。
 */
export async function requestStream(
  url: string,
  options: {
    headers?: Record<string, string>
    /** Range 起始字节 */
    start?: number
    /** Range 结束字节 */
    end?: number
    timeout?: number
    signal?: AbortSignal
  } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': DEFAULT_UA,
    ...(options.headers ?? {})
  }
  if (options.start !== undefined) {
    headers['Range'] = `bytes=${options.start}-${options.end ?? ''}`
  }

  const timeout = options.timeout ?? 0
  const signal =
    options.signal ?? (timeout > 0 ? AbortSignal.timeout(timeout) : undefined)

  return fetch(url, {
    method: 'GET',
    headers,
    redirect: 'follow',
    signal
  })
}

/** HEAD 探测：拿文件大小、类型、是否可访问 */
export async function probeUrl(
  url: string,
  headers?: Record<string, string>
): Promise<{ ok: boolean; status: number; size?: number; ext?: string; contentType?: string; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': DEFAULT_UA, ...(headers ?? {}) },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000)
    })
    const len = res.headers.get('content-length')
    const ct = res.headers.get('content-type') ?? undefined
    return {
      ok: res.ok,
      status: res.status,
      size: len ? Number(len) : undefined,
      ext: guessExtFromContentType(ct) ?? guessExtFromUrl(url),
      contentType: ct
    }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 由 content-type 推断扩展名 */
export function guessExtFromContentType(contentType?: string): string | undefined {
  if (!contentType) return undefined
  const ct = contentType.toLowerCase()
  if (ct.includes('audio/mpeg') || ct.includes('audio/mp3')) return 'mp3'
  if (ct.includes('audio/flac') || ct.includes('x-flac')) return 'flac'
  if (ct.includes('audio/mp4') || ct.includes('audio/aac') || ct.includes('audio/x-m4a')) return 'm4a'
  if (ct.includes('audio/ogg')) return 'ogg'
  if (ct.includes('audio/wav')) return 'wav'
  if (ct.includes('audio/x-ape')) return 'ape'
  return undefined
}

/** 由 URL 推断扩展名 */
export function guessExtFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname
    const match = /\.([a-z0-9]{2,5})$/i.exec(pathname)
    return match ? match[1].toLowerCase() : undefined
  } catch {
    return undefined
  }
}
