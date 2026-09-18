/**
 * 洛雪（lx-music）音源协议运行时
 *
 * 音源脚本开头的固定写法：
 *   const { EVENT_NAMES, request, on, send, utils, env, version } = globalThis.lx
 *
 * 于是宿主必须在脚本执行前，把 `lx` 注入到脚本所在上下文。
 * 本文件就是这个 `lx` 的完整实现（环境无关，HTTP 由 HostAdapter 提供）。
 */
import { createHash, createHmac, randomBytes, createCipheriv } from 'node:crypto'

/* ------------------------------------------------------------------ *
 * 协议常量
 * ------------------------------------------------------------------ */

/** 洛雪协议事件名 */
export const LX_EVENT_NAMES = {
  request: 'request',
  inited: 'inited',
  updateAlert: 'updateAlert'
} as const

export type LxEventName = (typeof LX_EVENT_NAMES)[keyof typeof LX_EVENT_NAMES]

/** 洛雪 request(options) 的入参 */
export interface LxRequestOptions {
  method?: string
  headers?: Record<string, string>
  /** 请求体：对象将被 JSON 序列化，字符串原样发送 */
  body?: unknown
  /** 表单（application/x-www-form-urlencoded） */
  form?: Record<string, unknown>
  /** 超时 ms */
  timeout?: number
  /** 最大重定向次数 */
  follow_max?: number
  /** 是否以 Buffer 形式返回 body */
  binary?: boolean
  /** 强制 json 解析 */
  json?: boolean
}

/** 洛雪 request 的响应对象 */
export interface LxResponse {
  statusCode: number
  statusMessage?: string
  headers: Record<string, string | string[] | undefined>
  /** 自动解析后的 body（json → 对象，否则字符串；binary → Buffer） */
  body: unknown
  /** 原始二进制 */
  raw: Buffer
  url: string
}

/** 脚本通过 send('inited') 上报的音源能力 */
export interface LxInitedSource {
  name: string
  type: string
  actions: string[]
  /** 注意：洛雪协议拼写就是 qualitys（非 qualities） */
  qualitys: string[]
}

export interface LxInitedPayload {
  status: boolean | 'success' | 'fail'
  sources: Record<string, LxInitedSource>
  openDevTools?: boolean
}

/** 宿主调用脚本时传入的请求体 */
export interface LxRequestPayload {
  action: 'musicUrl' | 'lyric' | 'pic' | 'musicSearch' | string
  source: string
  info: {
    type?: string
    musicInfo?: Record<string, unknown>
    keyword?: string
    page?: number
    pagesize?: number
    limit?: number
    [k: string]: unknown
  }
}

/** 日志等级 */
export type LxLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

/** 宿主适配器：把运行时需要的外部能力反向注入 */
export interface LxHostAdapter {
  /** 执行真实 HTTP 请求 */
  httpRequest(url: string, options: LxRequestOptions): Promise<LxResponse>
  /** 脚本上报初始化结果 */
  onInited(payload: LxInitedPayload): void
  /** 脚本上报更新提示 */
  onUpdateAlert(payload: unknown): void
  /** 脚本 console 输出 */
  onLog(level: LxLogLevel, args: unknown[]): void
  /** 宿主版本号（脚本会拿来做版本判断） */
  version: string
  /** 运行环境标识 */
  env: 'desktop' | 'mobile'
}

/** 脚本侧拿到的 request handler 签名 */
type LxRequestHandler = (payload: LxRequestPayload) => unknown

/* ------------------------------------------------------------------ *
 * utils 实现（buffer / crypto）—— 音源脚本会直接使用
 * ------------------------------------------------------------------ */

/** base64 / hex 等编码转换，对齐洛雪 utils.buffer 行为 */
const bufferUtils = {
  from(data: string | ArrayLike<number>, encoding: BufferEncoding = 'utf8'): Buffer {
    return Buffer.from(data as string, encoding)
  },
  bufToString(buf: Buffer | Uint8Array, encoding: BufferEncoding = 'utf8'): string {
    return Buffer.from(buf as Buffer).toString(encoding)
  },
  concat(list: Uint8Array[]): Buffer {
    return Buffer.concat(list.map((i) => Buffer.from(i)))
  },
  isBuffer(obj: unknown): boolean {
    return Buffer.isBuffer(obj)
  }
}

/** 摘要与加解密工具，覆盖脚本里常见的 md5/sha/aes/hmac 用法 */
const cryptoUtils = {
  md5(str: string | Buffer, format: 'hex' | 'base64' = 'hex'): string {
    return createHash('md5').update(str as never).digest(format as never) as string
  },
  sha1(str: string | Buffer, format: 'hex' | 'base64' = 'hex'): string {
    return createHash('sha1').update(str as never).digest(format as never) as string
  },
  sha256(str: string | Buffer, format: 'hex' | 'base64' = 'hex'): string {
    return createHash('sha256').update(str as never).digest(format as never) as string
  },
  hmac(
    algorithm: string,
    key: string,
    data: string | Buffer,
    format: 'hex' | 'base64' = 'hex'
  ): string {
    return createHmac(algorithm, key).update(data as never).digest(format as never) as string
  },
  randomBytes(size: number): Buffer {
    return randomBytes(size)
  },
  /** AES 加密（CBC / ECB），返回 base64 或 hex */
  aesEncrypt(
    buffer: Buffer,
    mode: 'aes-128-cbc' | 'aes-128-ecb' | 'aes-256-cbc' | 'aes-256-ecb' | string,
    key: string | Buffer,
    iv: string | Buffer = ''
  ): string {
    const cipher = createCipheriv(
      mode as never,
      typeof key === 'string' ? Buffer.from(key, 'utf8') : key,
      iv ? (typeof iv === 'string' ? Buffer.from(iv, 'utf8') : iv) : null
    )
    return Buffer.concat([cipher.update(buffer), cipher.final()]).toString('base64')
  },
  rsaEncrypt(_buffer: Buffer, _key: string): string {
    throw new Error('rsaEncrypt not implemented')
  }
}

/** 洛雪暴露给脚本的 utils 对象 */
export const lxUtils = {
  buffer: bufferUtils,
  crypto: cryptoUtils
}

/* ------------------------------------------------------------------ *
 * 运行时
 * ------------------------------------------------------------------ */

/**
 * 脚本自身的信息，对应洛雪协议的 `lx.currentScriptInfo`。
 *
 * 这是洛雪 v2.6+ 才补上的字段，但相当一部分音源会读它来构造请求头
 * （例如 `source-ver: currentScriptInfo.version`），缺失会让脚本直接抛
 * "Cannot read properties of undefined (reading 'version')"。
 */
export interface LxScriptInfo {
  name: string
  description: string
  version: string
  author: string
  homepage: string
  /** 脚本源码原文 */
  rawScript: string
}

export interface LxRuntimeOptions {
  host: LxHostAdapter
  /** 单个请求处理超时 ms，0 = 不限 */
  requestTimeout?: number
  /** 脚本元信息，用于注入 currentScriptInfo */
  scriptInfo?: Partial<LxScriptInfo>
}

/**
 * 一个音源脚本对应一个 LxRuntime。
 * 它既实现脚本侧 API，也负责把宿主的调用派发进脚本。
 */
export class LxRuntime {
  private readonly host: LxHostAdapter
  private readonly requestTimeout: number
  private readonly scriptInfo: Partial<LxScriptInfo>

  /** 脚本通过 on() 注册的事件处理器 */
  private readonly handlers = new Map<string, LxRequestHandler[]>()

  /** 脚本是否已完成初始化上报 */
  private inited = false
  private initedPayload: LxInitedPayload | null = null

  constructor(options: LxRuntimeOptions) {
    this.host = options.host
    this.requestTimeout = options.requestTimeout ?? 0
    this.scriptInfo = options.scriptInfo ?? {}
  }

  /* --------------------------- 脚本侧 API --------------------------- */

  /**
   * 构造注入进沙箱的对象。
   * 使用 getter 而非快照，保证 `const { on, send } = globalThis.lx` 解构依然可用。
   */
  createSandboxGlobal(): Record<string, unknown> {
    const self = this

    const lx = {
      EVENT_NAMES: { ...LX_EVENT_NAMES },
      /** 宿主版本：脚本会拿它做版本判断 */
      version: this.host.version,
      env: this.host.env,
      utils: lxUtils,
      /**
       * 脚本自身信息。洛雪 v2.6+ 提供，相当一部分音源会读它来构造请求头，
       * 不提供会让脚本在顶层直接抛错，整个音源都加载不起来。
       */
      currentScriptInfo: {
        name: '',
        description: '',
        version: '',
        author: '',
        homepage: '',
        rawScript: '',
        ...this.scriptInfo
      },

      /** 注册事件监听 */
      on(eventName: string, handler: LxRequestHandler): void {
        if (typeof handler !== 'function') return
        const list = self.handlers.get(eventName) ?? []
        list.push(handler)
        self.handlers.set(eventName, list)
      },

      /** 注销事件监听 */
      off(eventName: string, handler: LxRequestHandler): void {
        const list = self.handlers.get(eventName)
        if (!list) return
        const idx = list.indexOf(handler)
        if (idx >= 0) list.splice(idx, 1)
      },

      /** 脚本向宿主发消息 */
      send(eventName: string, data: unknown): void {
        self.handleSend(eventName, data)
      },

      /** HTTP 请求（回调风格，对齐洛雪） */
      request(url: string, options: LxRequestOptions, callback: (err: Error | null, resp?: LxResponse) => void): void {
        self
          .doRequest(url, options)
          .then((resp) => callback(null, resp))
          .catch((err: unknown) => callback(err instanceof Error ? err : new Error(String(err))))
      }
    }

    return lx
  }

  /** 脚本调用 send() 时的分发 */
  private handleSend(eventName: string, data: unknown): void {
    switch (eventName) {
      case LX_EVENT_NAMES.inited: {
        this.inited = true
        this.initedPayload = data as LxInitedPayload
        this.host.onInited(data as LxInitedPayload)
        break
      }
      case LX_EVENT_NAMES.updateAlert: {
        this.host.onUpdateAlert(data)
        break
      }
      default:
        this.host.onLog('warn', [`[lx] unknown event: ${eventName}`])
    }
  }

  /** 包装 HTTP 请求：统一异常与超时 */
  private async doRequest(url: string, options: LxRequestOptions): Promise<LxResponse> {
    if (typeof url !== 'string' || !url) throw new Error('request: invalid url')
    try {
      return await this.host.httpRequest(url, options ?? { method: 'GET' })
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err))
    }
  }

  /* --------------------------- 宿主侧 API --------------------------- */

  /** 脚本是否已上报初始化 */
  get isInited(): boolean {
    return this.inited
  }

  /** 脚本上报的初始化内容 */
  get initPayload(): LxInitedPayload | null {
    return this.initedPayload
  }

  /** 脚本是否注册了某事件的处理器 */
  hasHandler(eventName: string): boolean {
    const list = this.handlers.get(eventName)
    return Array.isArray(list) && list.length > 0
  }

  /**
   * 宿主发起调用：把 { action, source, info } 交给脚本的 request 处理器。
   * 脚本 handler 返回 Promise，宿主 await 其结果。
   */
  async dispatch(payload: LxRequestPayload): Promise<unknown> {
    const list = this.handlers.get(LX_EVENT_NAMES.request)
    if (!list || list.length === 0) {
      throw new Error('音源未注册 request 处理器')
    }

    let lastErr: unknown = null
    for (const handler of list) {
      try {
        const result = this.withTimeout(
          Promise.resolve(handler(payload)),
          this.requestTimeout,
          `音源处理超时 (action=${payload.action})`
        )
        return await result
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? '音源处理失败'))
  }

  /** 超时包装 */
  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    if (!ms || ms <= 0) return promise
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms)
      promise.then(
        (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        (e) => {
          clearTimeout(timer)
          reject(e)
        }
      )
    })
  }

  /** 释放（清空 handler 引用，帮助 GC） */
  dispose(): void {
    this.handlers.clear()
    this.initedPayload = null
    this.inited = false
  }
}
