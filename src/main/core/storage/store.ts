/**
 * 轻量 JSON 持久化
 *
 * 刻意不引入 better-sqlite3 之类的原生模块：
 *  - 免去 node-gyp / VS Build Tools 编译地狱
 *  - 配置与歌单这类数据量很小，JSON 足够
 * 写入采用「防抖 + 原子替换」，避免频繁 IO 与写坏文件。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface JsonStoreOptions {
  /** 写入防抖 ms */
  debounceMs?: number
  /** 是否美化输出 */
  pretty?: boolean
}

export class JsonStore<T extends object> {
  private data: T
  private readonly filePath: string
  private readonly defaults: T
  private readonly options: Required<JsonStoreOptions>
  private timer: NodeJS.Timeout | null = null
  private readonly listeners: ((next: T) => void)[] = []
  /** 已释放：后续写入直接落盘，不再挂防抖定时器 */
  private disposed = false

  constructor(filePath: string, defaults: T, options: JsonStoreOptions = {}) {
    this.filePath = filePath
    this.defaults = defaults
    this.options = {
      debounceMs: options.debounceMs ?? 300,
      pretty: options.pretty ?? true
    }
    this.data = this.read()
  }

  /** 读取当前内存数据（只读快照） */
  get(): T {
    return this.data
  }

  /**
   * 订阅变更。
   *
   * 用途：有些字段一变，别处的状态就得跟着调 —— 比如下载目录变了，
   * 本地流代理的白名单必须同步，否则换目录后新下的歌会播不了。
   */
  onChange(listener: (next: T) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const i = this.listeners.indexOf(listener)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  /** 浅合并更新并落盘 */
  set(patch: Partial<T>): T {
    this.data = { ...this.data, ...patch } as T
    this.scheduleSave()
    this.emit()
    return this.data
  }

  /** 整体替换 */
  replace(next: T): T {
    this.data = next
    this.scheduleSave()
    this.emit()
    return this.data
  }

  /** 从磁盘重新载入 */
  reload(): T {
    this.data = this.read()
    return this.data
  }

  /** 立即落盘（进程退出前调用） */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.writeNow()
  }

  /**
   * 释放：清掉防抖定时器 + 落盘 + 摘掉所有订阅者。
   *
   * 为什么要单独一个方法：防抖定时器是「活的句柄」。退出流程里如果只调 flush()
   * 而漏掉某个 store，那个 store 的定时器会一直在事件循环里挂着 ——
   * 主进程就得等它触发完才可能退干净。
   * 释放之后再来的 set() 改成同步落盘：数据不丢，也不会重新挂出定时器。
   */
  dispose(): void {
    this.disposed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.writeNow()
    this.listeners.length = 0
  }

  /** 是否还有未落盘的防抖定时器（诊断用） */
  get hasPendingWrite(): boolean {
    return this.timer !== null
  }

  /* ------------------------------ 内部 ------------------------------ */

  private read(): T {
    try {
      if (!existsSync(this.filePath)) return { ...this.defaults }
      const raw = readFileSync(this.filePath, 'utf8')
      if (!raw.trim()) return { ...this.defaults }
      const parsed = JSON.parse(raw) as Partial<T>
      // 与默认值合并，保证新增字段在老配置上也有值
      return { ...this.defaults, ...parsed } as T
    } catch {
      // 文件损坏时退回默认值，而不是让整个应用起不来
      return { ...this.defaults }
    }
  }

  private scheduleSave(): void {
    // 释放后不再挂定时器：直接写，保证数据不丢，也不给退出流程留活句柄
    if (this.disposed) {
      this.writeNow()
      return
    }
    // 同一个 store 上的重复写入只保留最后一次：防抖定时器永远只有一个
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.writeNow()
    }, this.options.debounceMs)
  }

  /** 通知订阅者；单个订阅者抛错不影响其它人 */
  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.data)
      } catch (err) {
        console.error('[store] 变更回调失败', err)
      }
    }
  }

  private writeNow(): void {
    try {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const content = this.options.pretty
        ? JSON.stringify(this.data, null, 2)
        : JSON.stringify(this.data)
      // 原子写：先写临时文件再替换，避免中途崩溃留下半个 JSON
      const tmp = `${this.filePath}.tmp`
      writeFileSync(tmp, content, 'utf8')
      renameSync(tmp, this.filePath)
    } catch (err) {
      console.error('[store] 写入失败', this.filePath, err)
    }
  }
}
