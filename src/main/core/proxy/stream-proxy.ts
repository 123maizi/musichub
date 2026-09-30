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
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { DEFAULT_UA, PLATFORM_REFERER } from '../net/http'

export interface WrapOptions {
  /** 目标平台（用于自动补 Referer） */
  platform?: string
  /** 显式指定 Referer */
  referer?: string
  /** 额外请求头 */
  headers?: Record<string, string>
}

/** 扩展名 → Content-Type，本地文件播放要它才对 */
const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wma': 'audio/x-ms-wma',
  '.ape': 'audio/x-ape'
}

export class StreamProxy {
  private server: http.Server | null = null
  private port = 0

  /**
   * 正在服务中的下游连接。
   *
   * 为什么必须自己跟踪：`server.close()` 只停止**接受新连接**，
   * 已经建立的连接（播放中的音频流就是长连接）不会断，close 的回调要等到
   * 最后一个连接自己走掉才触发。退出时如果干等它，进程就得多活好几秒；
   * 不等它，端口和句柄就留给系统回收。两条路都不对 —— 正确做法是主动断。
   */
  private readonly connections = new Set<import('node:net').Socket>()

  /**
   * 正在飞行中的上游请求。
   *
   * 退出时若不 abort，这些 fetch 会在后台继续拉数据，
   * 既吊着事件循环也白占带宽。
   */
  private readonly upstreams = new Set<AbortController>()

  /** 正在停止：新请求一律快速拒绝，不再发起上游请求 */
  private stopping = false

  /**
   * 允许通过 /local 读取的目录白名单（绝对路径）。
   *
   * 为什么要有白名单：这个代理只监听本机，但「本机的其它程序」也可能访问它。
   * 如果 /local 能读任意路径，它就成了一个任意文件读取接口 ——
   * 所以只放行音乐库与下载目录，其余一律拒绝。
   */
  private localRoots: string[] = []

  /**
   * 动态白名单来源。
   *
   * 只注册「当前下载目录」是不够的 —— 用户一旦改过下载目录，
   * 老目录里已经下好的歌就全被 403 挡在门外：文件明明在磁盘上、
   * 任务也写着已完成，点播放却什么都听不到。
   * 所以这里改成每次请求都现算：当前下载目录 + 默认目录 +
   * 下载任务记录里出现过的每一个目录。
   */
  private localRootsProvider: (() => string[]) | null = null

  /** 注册允许读取的目录（主进程在拿到下载目录后调用） */
  setLocalRoots(roots: string[]): void {
    this.localRoots = roots
      .filter(Boolean)
      .map((dir) => resolve(dir).replace(/[\\/]+$/, '').toLowerCase())
  }

  /** 注册动态白名单来源，优先级高于静态列表 */
  setLocalRootsProvider(fn: () => string[]): void {
    this.localRootsProvider = fn
  }

  /** 当前生效的白名单目录 */
  private roots(): string[] {
    if (!this.localRootsProvider) return this.localRoots
    try {
      return this.localRootsProvider()
        .filter(Boolean)
        .map((dir) => resolve(dir).replace(/[\\/]+$/, '').toLowerCase())
    } catch {
      return this.localRoots
    }
  }

  /** 启动代理服务，返回实际端口 */
  async start(preferredPort = 0): Promise<number> {
    if (this.server) return this.port
    this.stopping = false

    const server = http.createServer((req, res) => {
      void this.handle(req, res)
    })

    // 记下每条连接，退出时才能主动掐断（见 connections 的注释）
    server.on('connection', (socket) => {
      this.connections.add(socket)
      socket.on('close', () => this.connections.delete(socket))
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

  /**
   * 把本地音频文件包装成可播放地址。
   *
   * 为什么不直接用 file://：开发模式下渲染层是从 http://localhost 加载的，
   * 那个来源读 file:// 会被浏览器拦掉；而且 file:// 下没有 Range 语义，
   * 本地文件反而拖不了进度。走代理两边都正常。
   */
  wrapLocal(filePath: string): string {
    if (!filePath) return filePath
    if (!this.port) return filePath
    const encoded = Buffer.from(resolve(filePath), 'utf8').toString('base64url')
    return `${this.baseUrl}/local?p=${encoded}`
  }

  /**
   * 停止代理。
   *
   * 必须做到「关得干净、且不卡住」这两件事：
   *  - 断掉所有下游连接 —— 否则 server.close() 要等播放中的长连接自己结束；
   *  - abort 所有在途上游请求 —— 否则后台还在拉数据；
   *  - 兜底超时 800ms —— 无论如何都要 resolve，退出流程不能被它拖住。
   */
  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = null
    this.port = 0
    this.stopping = true

    for (const controller of this.upstreams) {
      try {
        controller.abort()
      } catch {
        /* 已经结束了 */
      }
    }
    this.upstreams.clear()

    for (const socket of this.connections) {
      try {
        socket.destroy()
      } catch {
        /* 已经断了 */
      }
    }
    this.connections.clear()

    await new Promise<void>((resolve) => {
      let settled = false
      let timer: NodeJS.Timeout | null = null
      const finish = (): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        // 定时器句柄必须清掉：留着一个 pending 的 setTimeout 会拖住事件循环
        timer = null
        resolve()
      }
      // 关不掉的挂起连接直接掐断，避免退出时卡住
      timer = setTimeout(finish, 800)
      server.close(() => finish())
      // Node 18.2+：把 keep-alive 空闲连接与仍在飞的连接一并关掉
      try {
        server.closeIdleConnections?.()
        server.closeAllConnections?.()
      } catch {
        /* 老版本 Node 没有这两个方法，上面的 destroy 已经兜住了 */
      }
    })
    this.stopping = false
  }

  /* ------------------------------ 请求处理 ------------------------------ */

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // 退出中：立刻拒绝，绝不再发起新的上游请求
    if (this.stopping) {
      this.fail(res, 503, 'proxy stopping')
      return
    }

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

    // 预检请求直接放行，不浪费一次上游请求
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders({}))
      res.end()
      return
    }

    /* ------------------------------ 本地文件 ------------------------------ */

    if (url.pathname === '/local') {
      this.serveLocal(req, res, url.searchParams.get('p'))
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

    // 每个上游请求挂一个 AbortController：退出时统一 abort，不留后台拉流
    const controller = new AbortController()
    this.upstreams.add(controller)

    try {
      const upstream = await fetch(target, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: controller.signal
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

      /**
       * Range 语义必须与上游实际情况一致，否则播放器会出问题。
       *
       * 典型故障：播放器请求 `Range: bytes=N-`，而上游不支持断点、回了 200 全量流。
       * 请求与响应的语义对不上时，浏览器会重新从头拉流 ——
       * 表现出来正是「听着听着突然跳回开头」。
       *
       * 所以这里明确告诉它「本地址不支持断点」，让它老老实实顺序播放。
       */
      if (range && upstream.status === 200) {
        outHeaders['accept-ranges'] = 'none'
        delete outHeaders['content-range']
      } else if (!outHeaders['accept-ranges']) {
        outHeaders['accept-ranges'] = 'bytes'
      }

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
      // abort 是「主动收摊」的正常路径，不必报成上游故障
      if (!controller.signal.aborted) {
        this.fail(res, 502, err instanceof Error ? err.message : 'upstream failed')
      }
    } finally {
      // 请求结束（无论成败）都要从在途表里摘掉，否则退出时会 abort 一堆死控制器
      this.upstreams.delete(controller)
    }
  }

  private fail(res: http.ServerResponse, code: number, message: string): void {
    try {
      if (res.headersSent) {
        res.destroy()
        return
      }
      res.writeHead(code, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }))
      res.end(message)
    } catch {
      // 连接可能已经被 destroy（退出中就是这样），静默收场
    }
  }

  /**
   * 服务本地音频文件（下载目录、音乐库）。
   *
   * 三件事必须做对，缺一个都会让本地文件「播不了」或「拖不动」：
   *   1. 白名单校验 —— 解析后的真实路径必须落在允许的目录内，
   *      否则 `..` 就能读到系统任意文件
   *   2. 正确的 Content-Type —— 给成 octet-stream，Chromium 会拒绝解码
   *   3. 真正的 Range 支持 —— 本地文件我们完全清楚长度，可以精确回 206
   */
  private serveLocal(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    encoded: string | null
  ): void {
    if (!encoded) {
      this.fail(res, 400, 'missing p')
      return
    }

    let filePath: string
    try {
      filePath = Buffer.from(encoded, 'base64url').toString('utf8')
    } catch {
      this.fail(res, 400, 'invalid p')
      return
    }

    if (!isAbsolute(filePath)) {
      this.fail(res, 400, 'path must be absolute')
      return
    }

    const full = resolve(filePath)
    if (!this.isInsideRoots(full)) {
      // 白名单外一律拒绝，且不透露是否存在的差别
      this.fail(res, 403, 'path not allowed')
      return
    }

    if (!existsSync(full)) {
      this.fail(res, 404, 'file not found')
      return
    }

    let size = 0
    try {
      const st = statSync(full)
      if (!st.isFile()) {
        this.fail(res, 404, 'not a file')
        return
      }
      size = st.size
    } catch {
      this.fail(res, 500, 'stat failed')
      return
    }

    const mime = MIME_BY_EXT[extname(full).toLowerCase()] ?? 'application/octet-stream'

    /* Range 解析：只支持最常见的单段 bytes=start-end */
    const rangeHeader = req.headers.range
    let start = 0
    let end = size - 1
    let status = 200

    if (rangeHeader) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
      if (m) {
        const [, rawStart, rawEnd] = m
        if (rawStart === '' && rawEnd !== '') {
          // bytes=-N：最后 N 字节
          start = Math.max(0, size - Number(rawEnd))
        } else {
          start = Number(rawStart)
          if (rawEnd !== '') end = Math.min(Number(rawEnd), size - 1)
        }
        if (!Number.isFinite(start) || start < 0 || start >= size) {
          res.writeHead(416, corsHeaders({ 'Content-Range': `bytes */${size}` }))
          res.end()
          return
        }
        status = 206
      }
    }

    const length = end - start + 1
    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes'
    }
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`

    if (req.method === 'HEAD') {
      res.writeHead(status, corsHeaders(headers))
      res.end()
      return
    }

    res.writeHead(status, corsHeaders(headers))
    const stream = createReadStream(full, { start, end })
    stream.pipe(res)
    stream.on('error', () => {
      try {
        res.destroy()
      } catch {
        /* 连接可能已断开 */
      }
    })
    req.on('close', () => stream.destroy())
  }

  /** 路径是否落在允许的目录内 */
  private isInsideRoots(full: string): boolean {
    const roots = this.roots()
    if (roots.length === 0) return false
    const target = full.toLowerCase()
    return roots.some((root) => {
      if (target === root) return false
      const rel = relative(root, target)
      // rel 不以 .. 开头且不是绝对路径 → 确实在目录内
      return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
    })
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
