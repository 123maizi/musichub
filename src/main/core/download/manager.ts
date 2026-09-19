/**
 * 下载管理器
 *
 * 职责：把「播放地址」变成「本地文件」。
 *  - 队列 + 并发控制
 *  - 断点续传（.part 文件 + Range）
 *  - 实时进度 / 速度上报
 *  - 完成后写入音频标签（封面、歌手、专辑）
 *
 * 取流一律复用 MusicResolver，因此「下载」和「播放」走的是同一套音源择优逻辑，
 * 播放不了的自然也下载不了，行为一致。
 */
import { EventEmitter } from 'node:events'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import type {
  DownloadAddRequest,
  DownloadConfig,
  DownloadTask
} from '@shared/types/download'
import type { Quality, Song } from '@shared/types/music'
import {
  DEFAULT_NAME_TEMPLATE,
  PLATFORM_META,
  QUALITY_META
} from '@shared/constants'
import type { MusicResolver } from '../source/resolver'
import type { JsonStore } from '../storage/store'
import { writeAudioTag } from './tag-writer'

export interface DownloadManagerDeps {
  resolver: MusicResolver
  configStore: JsonStore<DownloadConfig>
  /**
   * 下载记录的持久化存储。
   * 没有它，下载列表在重启后就空了 —— 用户下过的歌既看不到也播不了。
   */
  historyStore?: JsonStore<{ tasks: DownloadTask[] }>
  onLog?: (level: 'info' | 'warn' | 'error', scope: string, message: string) => void
}

/** 进度上报节流间隔，避免高频 IPC 打爆渲染层 */
const PROGRESS_THROTTLE = 300

export class DownloadManager extends EventEmitter {
  private readonly deps: DownloadManagerDeps
  private readonly tasks = new Map<string, DownloadTask>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly queue: string[] = []
  private running = 0
  private disposed = false

  constructor(deps: DownloadManagerDeps) {
    super()
    this.deps = deps
    this.restoreTasks()
  }

  /* ------------------------------ 任务持久化 ------------------------------ */

  /**
   * 从磁盘恢复下载记录。
   *
   * 之前这套记录只存在内存里 —— 关掉应用再打开，下载列表就是空的，
   * 用户明明下过歌，却既看不到、也没法在应用里播（这正是
   * 「下载的歌曲无法播放」的一半原因）。
   *
   * 恢复时把「下载中 / 排队中」这类未完成状态改成已暂停：
   * 上次进程已经没了，连接早断了，标记成暂停才符合实际，也让用户
   * 能点「继续」把 .part 接着下完。
   */
  private restoreTasks(): void {
    const store = this.deps.historyStore
    if (!store) return

    const saved = store.get().tasks ?? []
    for (const task of saved) {
      if (!task?.id) continue
      const restored: DownloadTask = { ...task }
      if (restored.status === 'downloading' || restored.status === 'pending' || restored.status === 'waiting') {
        restored.status = 'paused'
        restored.speed = 0
      }
      this.tasks.set(restored.id, restored)
    }

    if (saved.length > 0) {
      this.deps.onLog?.('info', 'download', `已恢复 ${saved.length} 条下载记录`)
    }
  }

  /** 把任务列表写回磁盘（只存有价值的字段，省得文件越来越大） */
  private persistTasks(): void {
    const store = this.deps.historyStore
    if (!store) return
    try {
      store.set({ tasks: this.list() })
    } catch (err) {
      this.deps.onLog?.('warn', 'download', `保存下载记录失败: ${errMsg(err)}`)
    }
  }

  /* ------------------------------ 配置 ------------------------------ */

  getConfig(): DownloadConfig {
    return this.deps.configStore.get()
  }

  setConfig(patch: Partial<DownloadConfig>): DownloadConfig {
    const next = this.deps.configStore.set(patch)
    if (patch.dir && !existsSync(next.dir)) {
      try {
        mkdirSync(next.dir, { recursive: true })
      } catch (err) {
        this.deps.onLog?.('error', 'download', `创建下载目录失败: ${errMsg(err)}`)
      }
    }
    return next
  }

  /* ------------------------------ 任务操作 ------------------------------ */

  /** 批量加入下载 */
  async add(req: DownloadAddRequest): Promise<DownloadTask[]> {
    const config = this.getConfig()
    const created: DownloadTask[] = []

    for (const song of req.songs) {
      const quality = req.quality ?? config.preferQuality
      const { fileName, savePath } = this.planPath(song, quality, config, req.sourceIds)

      const task: DownloadTask = {
        id: randomUUID(),
        song,
        quality,
        status: 'waiting',
        received: 0,
        total: 0,
        progress: 0,
        speed: 0,
        savePath,
        fileName,
        createdAt: Date.now(),
        writeTag: req.writeTag ?? config.writeTag
      }

      this.tasks.set(task.id, task)
      this.queue.push(task.id)
      created.push(task)
      this.emit('progress', { ...task })
    }

    // 入队即落盘：万一这一步之后应用被强杀，至少记录还在
    this.persistTasks()
    this.pump()
    return created
  }

  list(): DownloadTask[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  /** 暂停（中止当前连接，保留 .part 以便续传） */
  async pause(ids: string[]): Promise<void> {
    for (const id of ids) {
      const task = this.tasks.get(id)
      if (!task || (task.status !== 'downloading' && task.status !== 'pending' && task.status !== 'waiting')) {
        continue
      }
      this.controllers.get(id)?.abort()
      this.controllers.delete(id)
      task.status = 'paused'
      task.speed = 0
      this.emit('progress', { ...task })
    }
    this.persistTasks()
  }

  /** 继续下载 */
  async resume(ids: string[]): Promise<void> {
    for (const id of ids) {
      const task = this.tasks.get(id)
      if (!task || task.status !== 'paused') continue
      task.status = 'waiting'
      if (!this.queue.includes(id)) this.queue.push(id)
      this.emit('progress', { ...task })
    }
    this.persistTasks()
    this.pump()
  }

  /** 重试失败任务 */
  async retry(ids: string[]): Promise<void> {
    for (const id of ids) {
      const task = this.tasks.get(id)
      if (!task || (task.status !== 'error' && task.status !== 'cancelled')) continue
      task.status = 'waiting'
      task.error = undefined
      task.received = 0
      task.progress = 0
      if (!this.queue.includes(id)) this.queue.push(id)
      this.emit('progress', { ...task })
    }
    this.persistTasks()
    this.pump()
  }

  /** 移除任务，可选删除已下载文件 */
  async remove(ids: string[], deleteFile: boolean): Promise<void> {
    for (const id of ids) {
      const task = this.tasks.get(id)
      if (!task) continue
      this.controllers.get(id)?.abort()
      this.controllers.delete(id)
      const idx = this.queue.indexOf(id)
      if (idx >= 0) this.queue.splice(idx, 1)

      if (deleteFile) {
        for (const p of [task.savePath, `${task.savePath}.part`]) {
          try {
            if (existsSync(p)) rmSync(p, { force: true })
          } catch {
            /* 文件可能被其它程序占用 */
          }
        }
      }
      this.tasks.delete(id)
    }
    this.persistTasks()
  }

  /** 清空已完成记录（不删文件） */
  async clearFinished(): Promise<void> {
    for (const [id, task] of this.tasks) {
      if (task.status === 'done') this.tasks.delete(id)
    }
    this.persistTasks()
  }

  dispose(): void {
    this.disposed = true
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    this.queue.length = 0
    this.deps.configStore.flush()
    // 退出前把任务列表落盘，否则重启后下载记录又没了
    this.persistTasks()
    this.deps.historyStore?.flush()
  }

  /* ------------------------------ 调度 ------------------------------ */

  /** 按并发上限启动排队任务 */
  private pump(): void {
    if (this.disposed) return
    const { concurrency } = this.getConfig()

    while (this.running < Math.max(1, concurrency) && this.queue.length > 0) {
      const id = this.queue.shift()
      if (!id) break
      const task = this.tasks.get(id)
      if (!task || task.status !== 'waiting') continue

      this.running += 1
      void this.execute(task)
        .catch(() => undefined)
        .finally(() => {
          this.running -= 1
          this.pump()
        })
    }
  }

  /** 执行单个下载任务（含重试） */
  private async execute(task: DownloadTask): Promise<void> {
    const config = this.getConfig()
    const maxAttempt = Math.max(1, config.retry + 1)

    for (let attempt = 1; attempt <= maxAttempt; attempt += 1) {
      // 读入局部变量：TS 会对 task.status 做流收窄，导致此处比较被判为恒假
      const status: string = task.status
      if (this.disposed || status === 'paused' || status === 'cancelled') return

      const controller = new AbortController()
      this.controllers.set(task.id, controller)

      try {
        await this.runOnce(task, controller.signal, config)
        this.controllers.delete(task.id)
        task.status = 'done'
        task.progress = 100
        task.speed = 0
        task.finishedAt = Date.now()
        this.emit('done', { ...task })
        this.emit('progress', { ...task })
        this.persistTasks()
        this.deps.onLog?.('info', 'download', `下载完成: ${task.fileName}`)
        return
      } catch (err) {
        this.controllers.delete(task.id)

        if (controller.signal.aborted) {
          // 用户主动暂停/取消，不算失败
          if (task.status !== 'paused' && task.status !== 'cancelled') task.status = 'paused'
          this.emit('progress', { ...task })
          this.persistTasks()
          return
        }

        const message = errMsg(err)
        if (attempt >= maxAttempt) {
          task.status = 'error'
          task.error = message
          task.speed = 0
          this.emit('error', { ...task })
          this.emit('progress', { ...task })
          this.persistTasks()
          this.deps.onLog?.('error', 'download', `下载失败 ${task.fileName}: ${message}`)
          return
        }

        this.deps.onLog?.('warn', 'download', `${task.fileName} 第 ${attempt} 次失败，重试中: ${message}`)
        await sleep(800 * attempt)
      }
    }
  }

  /** 单次下载尝试 */
  private async runOnce(task: DownloadTask, signal: AbortSignal, config: DownloadConfig): Promise<void> {
    task.status = 'pending'
    this.emit('progress', { ...task })

    // 1) 取流（走与播放同一套音源择优逻辑）
    const resolved = await this.deps.resolver.resolve({
      song: task.song,
      quality: task.quality
    })
    task.sourceId = resolved.sourceId
    task.sourceName = resolved.sourceName

    // 扩展名以真实地址为准
    if (resolved.ext && !task.savePath.toLowerCase().endsWith(`.${resolved.ext}`)) {
      task.savePath = task.savePath.replace(/\.[a-z0-9]+$/i, `.${resolved.ext}`)
      task.fileName = task.fileName.replace(/\.[a-z0-9]+$/i, `.${resolved.ext}`)
    }

    if (!existsSync(config.dir)) mkdirSync(config.dir, { recursive: true })
    const partPath = `${task.savePath}.part`

    // 2) 下载（带断点续传）
    task.status = 'downloading'
    this.emit('progress', { ...task })
    await this.streamToFile(resolved.url, partPath, task, signal)

    // 3) 落盘：.part → 正式文件
    if (existsSync(task.savePath)) rmSync(task.savePath, { force: true })
    renameSync(partPath, task.savePath)

    // 4) 写标签（失败不影响下载结果）
    if (task.writeTag && config.writeTag) {
      try {
        await writeAudioTag(task.savePath, {
          title: task.song.name,
          artist: task.song.singer,
          album: task.song.albumName,
          coverUrl: config.downloadCover ? task.song.picUrl : undefined,
          comment: `MusicHub · ${PLATFORM_META[task.song.platform]?.name ?? task.song.platform}`
        })
      } catch (err) {
        this.deps.onLog?.('warn', 'download', `写入标签失败（不影响文件）: ${errMsg(err)}`)
      }
    }
  }

  /** 流式写入文件，带断点续传与进度上报 */
  private async streamToFile(
    url: string,
    partPath: string,
    task: DownloadTask,
    signal: AbortSignal
  ): Promise<void> {
    let existing = 0
    if (existsSync(partPath)) {
      try {
        existing = statSync(partPath).size
      } catch {
        existing = 0
      }
    }

    const headers: Record<string, string> = {}
    if (existing > 0) headers['Range'] = `bytes=${existing}-`

    const res = await fetch(url, { headers, signal, redirect: 'follow' })
    if (!res.ok && res.status !== 206) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }

    // 服务端不支持续传时，从头重新下载
    const serverSupportsRange = res.status === 206
    if (!serverSupportsRange) existing = 0

    const contentLength = Number(res.headers.get('content-length') ?? 0)
    task.total = contentLength > 0 ? contentLength + existing : 0
    task.received = existing
    task.progress = task.total > 0 ? (existing / task.total) * 100 : 0

    if (!res.body) throw new Error('响应体为空')

    const stream = createWriteStream(partPath, { flags: serverSupportsRange && existing > 0 ? 'a' : 'w' })
    const reader = res.body.getReader()

    let lastEmit = 0
    let windowStart = Date.now()
    let windowBytes = task.received

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (signal.aborted) throw new Error('已中止')

        const buf = Buffer.from(value)
        await new Promise<void>((resolve, reject) => {
          stream.write(buf, (err) => (err ? reject(err) : resolve()))
        })

        task.received += buf.length
        task.progress =
          task.total > 0 ? Math.min(99.9, (task.received / task.total) * 100) : task.progress

        const now = Date.now()
        if (now - lastEmit >= PROGRESS_THROTTLE) {
          const elapsed = (now - windowStart) / 1000
          if (elapsed > 0.4) {
            task.speed = Math.max(0, Math.round((task.received - windowBytes) / elapsed))
            windowStart = now
            windowBytes = task.received
          }
          lastEmit = now
          this.emit('progress', { ...task })
        }
      }
    } finally {
      await new Promise<void>((resolve) => stream.end(() => resolve()))
      reader.cancel().catch(() => undefined)
    }
  }

  /* ------------------------------ 路径规划 ------------------------------ */

  /** 根据配置模板计算最终保存路径，并处理重名 */
  private planPath(
    song: Song,
    quality: Quality,
    config: DownloadConfig,
    _sourceIds?: string[]
  ): { fileName: string; savePath: string } {
    const base = renderFileName(config.nameTemplate, song, quality)
    const ext = 'mp3'
    let fileName = `${base}.${ext}`
    let savePath = join(config.dir, fileName)

    if (existsSync(savePath)) {
      switch (config.conflict) {
        case 'overwrite':
          break
        case 'skip':
          // 已存在则沿用（上层下载会覆盖，这里给出相同路径以便统计）
          break
        case 'rename':
        default: {
          let i = 1
          while (existsSync(savePath) && i < 500) {
            fileName = `${base} (${i}).${ext}`
            savePath = join(config.dir, fileName)
            i += 1
          }
          break
        }
      }
    }

    return { fileName, savePath }
  }
}

/* ------------------------------ 工具 ------------------------------ */

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 渲染文件名模板，并清理非法字符 */
export function renderFileName(template: string, song: Song, quality: Quality): string {
  const raw = template
    .replace(/\{name\}/gi, song.name)
    .replace(/\{singer\}/gi, song.singer || '未知歌手')
    .replace(/\{album\}/gi, song.albumName || '未知专辑')
    .replace(/\{quality\}/gi, QUALITY_META[quality]?.short ?? String(quality))
    .replace(/\{platform\}/gi, PLATFORM_META[song.platform]?.name ?? String(song.platform))

  return sanitizeFileName(raw)
}

/** 文件名安全化：去掉 Windows / POSIX 非法字符与过长名字 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/[.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 150) || '未知歌曲'
}

/** 默认文件名模板（UI 首次进入设置页时展示） */
export const DEFAULT_TEMPLATE = DEFAULT_NAME_TEMPLATE
