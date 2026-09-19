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
