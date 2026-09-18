/**
 * 音源脚本沙箱
 *
 * 用 node:vm 在独立上下文中执行第三方音源脚本，并注入脚本所需的全部全局：
 *  - lx       洛雪协议对象（可选）
 *  - module / exports / require  CommonJS 支撑（MusicFree 插件格式需要）
 *  - console  日志捕获（转发给宿主，脚本报错时能看到上下文）
 *  - 定时器   可跟踪、可清理，防止脚本泄漏
 *  - fetch    由宿主转发的简化实现（脚本不直连网络）
 *
 * 安全说明：vm 不是安全边界，它的目标是「隔离全局、限制能力、可回收」，
 * 而不是防御恶意代码。因此这里额外做了模块白名单与定时器回收，
 * 但请注意音源脚本始终来自第三方，只应导入可信来源。
 */
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { describeError } from '@main/utils/error'
import type { LxRuntime } from './lx-protocol'

/** 允许脚本 require 的 Node 内建模块白名单（刻意排除 fs / child_process / net 等） */
const REQUIRED_MODULE_WHITELIST = new Set([
  'crypto',
  'buffer',
  'url',
  'querystring',
  'path',
  'util',
  'string_decoder',
  'stream',
  'zlib',
  'events'
])

/** 简化版 fetch 的宿主实现 */
export type SandboxFetch = (url: string, init?: Record<string, unknown>) => Promise<unknown>

export interface SandboxOptions {
  /** 脚本来源标识（出现在堆栈里，便于定位） */
  filename: string
  /** 脚本源码 */
  code: string
  /** 洛雪运行时；不传则脚本无法使用 globalThis.lx */
  lxRuntime?: LxRuntime
  /** 日志回调 */
  onLog: (level: 'log' | 'info' | 'warn' | 'error' | 'debug', args: unknown[]) => void
  /** 由宿主提供的 fetch 实现 */
  fetchImpl?: SandboxFetch
  /** 同步执行超时 ms（只限制顶层同步代码） */
  runTimeoutMs?: number
  /** 注入的额外全局 */
  extraGlobals?: Record<string, unknown>
}

export interface SandboxResult {
  /** CommonJS 导出的对象（MusicFree 插件格式） */
  moduleExports: unknown
  /** 顶层同步执行是否抛错 */
  error?: string
  /** 脚本声明的全局变量快照（洛雪格式脚本常用于自检） */
  globalsClaimed: string[]
}

/**
 * 一个音源脚本的沙箱实例。负责执行脚本、回收资源。
 */
export class SourceSandbox {
  private readonly options: SandboxOptions
  private context: vm.Context | null = null
  private readonly timers = new Set<NodeJS.Timeout>()
  private disposed = false

  constructor(options: SandboxOptions) {
    this.options = options
  }

  /** 执行脚本，返回执行结果 */
  run(): SandboxResult {
    if (this.disposed) throw new Error('沙箱已释放')

    const { options } = this
    const sandboxConsole = this.createConsole()
    const { moduleObj, exportsObj } = this.createCommonJS()

    const sandbox: Record<string, unknown> = {
      console: sandboxConsole,
      module: moduleObj,
      exports: exportsObj,
      require: this.createRequire(),
      Buffer,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      process: {
        // 只暴露无害字段，避免脚本触达宿主进程能力
        env: {},
        platform: process.platform,
        version: process.version,
        nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) =>
          process.nextTick(() => fn(...args))
      },
      setTimeout: this.wrapTimer(setTimeout, false),
      setInterval: this.wrapTimer(setInterval, true),
      clearTimeout: (id: NodeJS.Timeout) => {
        this.timers.delete(id)
        clearTimeout(id)
      },
      clearInterval: (id: NodeJS.Timeout) => {
        this.timers.delete(id)
        clearInterval(id)
      },
      queueMicrotask,
      atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
      btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
      ...(options.extraGlobals ?? {})
    }

    if (options.fetchImpl) {
      sandbox.fetch = options.fetchImpl
    }

    if (options.lxRuntime) {
      sandbox.lx = options.lxRuntime.createSandboxGlobal()
    }

    // 自引用，让脚本里的 globalThis / window 都能拿到注入的全局
    sandbox.globalThis = sandbox
    sandbox.window = sandbox
    sandbox.self = sandbox

    this.context = vm.createContext(sandbox, {
      name: options.filename,
      codeGeneration: { strings: true, wasm: false }
    })

    let error: string | undefined
    try {
      const script = new vm.Script(options.code, {
        filename: options.filename
      })
      script.runInContext(this.context, {
        timeout: options.runTimeoutMs ?? 10000,
        breakOnSigint: false
      })
    } catch (err) {
      // 必须保留完整堆栈：音源脚本出错时，这是唯一能定位问题位置的线索
      error = describeError(err)
      options.onLog('error', [`[sandbox] 脚本执行异常: ${error}`])
    }

    return {
      moduleExports: moduleObj.exports,
      error,
      globalsClaimed: Object.keys(sandbox)
    }
  }

  /** 脚本执行完后，取回 CommonJS 导出（有些脚本异步赋值 exports，需延迟读取） */
  readExports(): unknown {
    const moduleObj = this.context?.module as { exports?: unknown } | undefined
    return moduleObj?.exports
  }

  /** 取回沙箱内的某个全局变量（如脚本自建的变量） */
  readGlobal<T = unknown>(name: string): T | undefined {
    return this.context?.[name] as T | undefined
  }

  /** 释放：清定时器、断开 context 引用 */
  dispose(): void {
    this.disposed = true
    for (const timer of this.timers) {
      try {
        clearTimeout(timer)
        clearInterval(timer)
      } catch {
        /* ignore */
      }
    }
    this.timers.clear()
    this.context = null
  }

  /* ------------------------------ 内部 ------------------------------ */

  /** 构造 console：把脚本输出转发给宿主，便于音源排障 */
  private createConsole(): Record<string, (...args: unknown[]) => void> {
    const { onLog, filename } = this.options
    const tag = filename.split(/[\\/]/).pop() ?? filename
    const make =
      (level: 'log' | 'info' | 'warn' | 'error' | 'debug') =>
      (...args: unknown[]): void => {
        onLog(level, [`[${tag}]`, ...args])
      }
    return {
      log: make('log'),
      info: make('info'),
      warn: make('warn'),
      error: make('error'),
      debug: make('debug'),
      trace: make('debug'),
      // 脚本里常见的分组输出，直接吞掉（不产生噪音）
      group: () => undefined,
      groupEnd: () => undefined,
      table: make('log'),
      dir: make('log'),
      time: () => undefined,
      timeEnd: () => undefined,
      assert: () => undefined
    }
  }

  /** 构造 CommonJS 支撑 */
  private createCommonJS(): { moduleObj: { exports: unknown }; exportsObj: unknown } {
    const moduleObj: { exports: unknown } = { exports: {} }
    // exports 初始应指向 module.exports，且脚本可能整体覆盖 module.exports
    return { moduleObj, exportsObj: moduleObj.exports }
  }

  /** 构造受限 require */
  private createRequire(): (name: string) => unknown {
    const nodeRequire = createRequire(import.meta.url || __filename)
    const { onLog } = this.options
    return (name: string): unknown => {
      const normalized = String(name).replace(/^node:/, '')
      if (!REQUIRED_MODULE_WHITELIST.has(normalized)) {
        onLog('warn', [`[sandbox] 脚本尝试 require 未授权模块: ${name}`])
        throw new Error(`module "${name}" is not allowed in sandbox`)
      }
      return nodeRequire(`node:${normalized}`)
    }
  }

  /**
   * 捕获逃逸到事件循环的脚本错误。
   *
   * 音源脚本常带后台轮询/延迟任务，其回调里抛的错如果不能在这里截住，
   * 就会一路冒泡成宿主的 uncaughtException —— 一个坏音源足以拖垮整个应用。
   */
  private reportAsync(err: unknown): void {
    this.options.onLog('error', [`[sandbox] 脚本异步异常: ${describeError(err)}`])
  }

  /** 包装定时器：记录句柄以便回收，并截住回调里的同步异常与 Promise 拒绝 */
  private wrapTimer(
    fn: typeof setTimeout | typeof setInterval,
    _repeating: boolean
  ): (handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]) => NodeJS.Timeout {
    return (handler, timeout, ...args) => {
      const self = this
      const timer = (fn as typeof setTimeout)(
        (...cbArgs: unknown[]) => {
          self.timers.delete(timer)
          if (self.disposed || typeof handler !== 'function') return
          try {
            // 显式标成 unknown：脚本回调可能返回 Promise，需要做运行时判断
            const result: unknown = handler(...cbArgs)
            // 回调返回 Promise 时同样要兜住，否则 rejection 会逃逸
            if (result && typeof (result as { catch?: unknown }).catch === 'function') {
              ;(result as Promise<unknown>).catch((err: unknown) => self.reportAsync(err))
            }
          } catch (err) {
            self.reportAsync(err)
          }
        },
        timeout,
        ...args
      )
      this.timers.add(timer)
      return timer
    }
  }
}
