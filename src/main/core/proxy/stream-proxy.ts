/**
 * 本地流代理
 *
 * 为什么必须有它：
 *  1. 防盗链 —— 各平台返回的媒体地址普遍校验 Referer / UA / Cookie，
 *     直接把裸地址丢给 <audio> 会被 403。
 *  2. 跨域 —— 渲染进程播放媒体时受 CORS 限制，本地代理统一加上 CORS 头。
 *  3. Range —— 播放器的拖动进度需要断点请求，代理原样透传 Range。
 *  4. 体积 —— 流式转发，不在内存里缓冲整首歌。
 *
 * 只监听 127.0.0.1，且校验 Host 头，避免被本机其它程序当作开放代理。
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { DEFAULT_UA, PLATFORM_REFERER } from '../net/http'

export interface WrapOptions {
  /** 目标平台（用于自动补 Referer） */
  platform?: string
  /** 显式指定 Referer */
  referer?: string
  /** 额外请求头 */
  headers?: Record<string, string>
}

export class StreamProxy {
  private server: http.Server | null = null
  private port = 0

  /** 启动代理服务，返回实际端口 */
  async start(preferredPort = 0): Promise<number> {
    if (this.server) return this.port

    const server = http.createServer((req, res) => {
      void this.handle(req, res)
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(preferredPort, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })

    this.server = server
    this.port = (server.address() as AddressInfo).port
    return this.port
  }

  /** 代理基地址，例如 http://127.0.0.1:38271 */
  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  get currentPort(): number {
    return this.port
  }

  /** 把真实媒体地址包装成本地代理地址 */
  wrap(url: string, options: WrapOptions = {}): string {
    if (!url) return url
    if (!this.port) return url

    const encoded = Buffer.from(url, 'utf8').toString('base64url')
    const params = new URLSearchParams()
    params.set('u', encoded)

    const referer = options.referer ?? (options.platform ? PLATFORM_REFERER[options.platform] : undefined)
    if (referer) params.set('r', referer)

    if (options.headers && Object.keys(options.headers).length > 0) {
      params.set('h', Buffer.from(JSON.stringify(options.headers), 'utf8').toString('base64url'))
    }

    return `${this.baseUrl}/stream?${params.toString()}`
  }

  /** 停止代理 */
  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = null
    this.port = 0
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      // 关不掉的挂起连接直接掐断，避免退出时卡住
      setTimeout(() => resolve(), 1500)
    })
  }

  /* ------------------------------ 请求处理 ------------------------------ */

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const host = req.headers.host ?? ''
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      this.fail(res, 403, 'forbidden host')
      return
    }

    const url = new URL(req.url ?? '/', this.baseUrl)

    if (url.pathname === '/health') {
      res.writeHead(200, corsHeaders({ 'Content-Type': 'text/plain' }))
      res.end('ok')
      return
    }

    if (url.pathname !== '/stream') {
      this.fail(res, 404, 'not found')
      return
    }

    const encoded = url.searchParams.get('u')
    if (!encoded) {
      this.fail(res, 400, 'missing u')
      return
    }

    let target: string
    try {
      target = Buffer.from(encoded, 'base64url').toString('utf8')
      // 只允许 http/https，避免 file:// 之类的本地读取
      const parsed = new URL(target)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('unsupported protocol')
      }
    } catch {
      this.fail(res, 400, 'invalid u')
      return
    }

    const headers: Record<string, string> = { 'User-Agent': DEFAULT_UA }
    const referer = url.searchParams.get('r')
    if (referer) headers['Referer'] = referer
    const extra = url.searchParams.get('h')
    if (extra) {
      try {
        const parsed = JSON.parse(Buffer.from(extra, 'base64url').toString('utf8')) as Record<string, string>
        for (const [k, v] of Object.entries(parsed)) {
          if (k.toLowerCase() === 'host') continue
          headers[k] = String(v)
        }
      } catch {
        /* 额外头解析失败不影响主流程 */
      }
    }
    // 原样透传 Range，播放器 seek 依赖它
    const range = req.headers.range
    if (range) headers['Range'] = range

    // 预检请求直接放行，不浪费一次上游请求
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders({}))
      res.end()
      return
    }

    try {
      const upstream = await fetch(target, {
        method: 'GET',
        headers,
        redirect: 'follow'
      })

      const outHeaders: Record<string, string> = {}
      const passthrough = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'etag',
        'last-modified',
        'cache-control'
      ]
      for (const key of passthrough) {
        const value = upstream.headers.get(key)
        if (value) outHeaders[key] = value
      }
      // 上游没声明可断点续传时补一个，让播放器敢做 seek
      if (!outHeaders['accept-ranges']) outHeaders['accept-ranges'] = 'bytes'

      res.writeHead(upstream.status, corsHeaders(outHeaders))

      if (!upstream.body) {
        res.end()
        return
      }

      const reader = upstream.body.getReader()
      const pump = async (): Promise<void> => {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!res.write(Buffer.from(value))) {
            // 下游写不动了就等 drain，避免内存堆积
            await new Promise<void>((resolve) => res.once('drain', () => resolve()))
          }
        }
        res.end()
      }

      pump().catch(() => {
        try {
          res.destroy()
        } catch {
          /* 连接可能已经断开 */
        }
      })

      // 客户端中断播放时，及时掐掉上游请求
      req.on('close', () => {
        reader.cancel().catch(() => undefined)
      })
    } catch (err) {
      this.fail(res, 502, err instanceof Error ? err.message : 'upstream failed')
    }
  }

  private fail(res: http.ServerResponse, code: number, message: string): void {
    if (res.headersSent) {
      res.destroy()
      return
    }
    res.writeHead(code, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }))
    res.end(message)
  }
}

/** 统一的 CORS / 缓存头 */
function corsHeaders(base: Record<string, string>): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    ...base
  }
}
