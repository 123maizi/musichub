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
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

import type {
  DownloadAddRequest,
  DownloadConfig,
  DownloadFileAudit,
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
import { describeNonAudio, extMismatch, sniffAudioFormat } from './audio-format'
import { resolveCover } from '../cover'

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

  /**
   * 重试等待中的定时器（句柄 → 用来立刻唤醒的回调）。
   *
   * 为什么要登记：重试等待是一段 0.8~2.4 秒的 sleep，退出时如果不叫醒它，
   * 主进程就得多挂着一个 pending 定时器；清了却不 resolve 又会让 execute()
   * 永久停在 await 上（留下一个永远不会结束的异步帧）。两个都要处理。
   */
  private readonly retryTimers = new Map<NodeJS.Timeout, () => void>()

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

  /**
   * 下载任务记录里出现过的所有目录（去重）。
   *
   * 用来扩本地播放白名单：改过下载目录之后，老目录里已下好的歌
   * 仍然要能播 —— 它们就躺在磁盘上，凭什么因为设置变了就播不了。
   */
  listDirs(): string[] {
    const dirs = new Set<string>()
    for (const t of this.tasks.values()) {
      if (!t.savePath) continue
      try {
        dirs.add(dirname(t.savePath))
      } catch {
        /* 路径异常就跳过 */
      }
    }
    return [...dirs]
  }

  /**
   * 体检：已完成任务指向的文件到底还在不在。
   *
   * 「任务列表里明明写着已完成，点播放却没声音」最常见的成因就是文件已经不在了
   * —— 被同名任务覆盖过、被用户手动清理过、或者上一次删除任务时被连带删掉了。
   * 与其等播放时报一个笼统的失败，不如把状态直接标在列表上。
   */
  audit(): Record<string, DownloadFileAudit> {
    const out: Record<string, DownloadFileAudit> = {}
    for (const t of this.tasks.values()) {
      if (t.status !== 'done') continue
      let exists = false
      let size = 0
      try {
        if (existsSync(t.savePath)) {
          exists = true
          size = statSync(t.savePath).size
        }
      } catch {
        exists = false
      }
      out[t.id] = { exists, size, suspicious: exists && size < 4096 }
    }
    return out
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
        const key = pathKey(task.savePath)
        const shared = [...this.tasks.values()].some(
          (t) => t.id !== id && pathKey(t.savePath) === key
        )
        if (shared) {
          this.deps.onLog?.(
            'warn',
            'download',
            `跳过删除（另有任务指向同一文件）: ${task.fileName}`
          )
        } else if (!isInsideDir(task.savePath, this.getConfig().dir)) {
          // 安全阀：只允许删除下载目录以内的文件
          this.deps.onLog?.(
            'warn',
            'download',
            `跳过删除（不在下载目录内）: ${task.savePath}`
          )
        } else {
          // 新命名 + 旧命名都清一遍，免得老任务留下残骸
          for (const p of [task.savePath, this.partPathOf(task), `${task.savePath}.part`]) {
            try {
              if (existsSync(p)) rmSync(p, { force: true })
            } catch {
              /* 文件可能被其它程序占用 */
            }
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
    // 1) 中止所有在途下载：AbortController 会打断 fetch 的响应体读取，
    //    streamToFile 的 finally 随即关闭 .part 写句柄，不会留下半个文件句柄
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    this.queue.length = 0

    // 2) 叫醒所有重试等待，别让退出流程挂在一个 sleep 上
    for (const [timer, wake] of this.retryTimers) {
      clearTimeout(timer)
      try {
        wake()
      } catch {
        /* 唤醒失败不影响退出 */
      }
    }
    this.retryTimers.clear()

    // 3) 摘掉事件监听，退出过程中不再往已销毁的窗口广播
    this.removeAllListeners()

    // 4) 落盘：配置 + 任务列表，并清掉防抖定时器
    this.deps.configStore.dispose()
    this.persistTasks()
    this.deps.historyStore?.dispose()
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
        await this.waitRetry(800 * attempt)
        // 等待期间被 dispose / 暂停，就别再往下走了
        if (this.disposed) return
      }
    }
  }

  /** 可被 dispose 立刻打断的等待（见 retryTimers 的注释） */
  private waitRetry(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.retryTimers.delete(timer)
        resolve()
      }, ms)
      this.retryTimers.set(timer, resolve)
    })
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
    const prevSourceId = task.sourceId
    task.sourceId = resolved.sourceId
    task.sourceName = resolved.sourceName
    // 音源实际给的档位可能低于请求值（自动降级），记下来给界面如实展示
    if (resolved.quality) task.actualQuality = resolved.quality

    // 扩展名以真实地址为准。改名后可能撞上别的任务/别的文件，所以走 freePath 找空位，
    // 绝不能直接落在一个已存在的文件上（下一步的 renameSync 会把它覆盖掉）。
    if (resolved.ext && !task.savePath.toLowerCase().endsWith(`.${resolved.ext}`)) {
      const want = task.savePath.replace(/\.[a-z0-9]+$/i, `.${resolved.ext}`)
      const safe = this.freePath(want, task.id)
      const safeName = safe.slice(safe.lastIndexOf(sep) + 1)
      if (safe !== want) {
        this.deps.onLog?.('warn', 'download', `${task.fileName} → ${safeName}（避免与已有文件冲突）`)
      }
      task.savePath = safe
      task.fileName = safeName
    }

    if (!existsSync(config.dir)) mkdirSync(config.dir, { recursive: true })
    const partPath = this.partPathOf(task)

    /**
     * 换源就不续传。
     *
     * 续传的语义是「接着上次没下完的地方继续」，前提是两段字节来自同一个文件。
     * 一旦这次解析到了别的音源，同一个偏移指向的是另一段数据，硬接起来会得到
     * 一个「下载成功」的坏文件 —— 前半段一个编码器、后半段另一个。
     * 宁可丢掉那点已下载的进度重来，也不要交出一个播不了的文件。
     */
    if (existsSync(partPath) && task.partSourceId && prevSourceId && task.partSourceId !== task.sourceId) {
      this.deps.onLog?.(
        'warn',
        'download',
        `音源已变化（${task.partSourceId} → ${task.sourceId}），丢弃上次残留重新下载: ${task.fileName}`
      )
      try {
        rmSync(partPath, { force: true })
      } catch {
        /* 删不掉就让它去撞下面的覆盖写 */
      }
      task.received = 0
      task.total = 0
      task.progress = 0
    }
    task.partSourceId = task.sourceId

    // 2) 下载（带断点续传）
    task.status = 'downloading'
    this.emit('progress', { ...task })
    await this.streamToFile(resolved.url, partPath, task, signal)

    /**
     * 3) 先校验「下下来的确实是音频」，**再**决定落盘去哪。
     *
     * 顺序是这里最关键的一件事。旧代码是先 renameSync 覆盖到目标路径、
     * 再校验内容，校验失败就把刚覆盖上去的文件删掉 ——
     * 于是「重下一首歌」最坏的结果是：用户原来的成品被覆盖，新文件又不合格被删，
     * 两头落空，只剩一个指向空气的任务记录。用户看到的就是「下载完听不了」。
     *
     * 音源出问题时返回的地址可能指向一个网页、一段 JSON 或空响应，
     * 这些内容照样会被写进文件、任务照样显示「已完成」，直到播放才发现坏了。
     * 所以：不合格就只丢弃 .part，绝不去碰目标路径上的任何东西。
     */
    const head = this.readHead(partPath, 64)
    const format = sniffAudioFormat(head)
    if (!format) {
      try {
        rmSync(partPath, { force: true })
      } catch {
        /* 删不掉也不影响结论 */
      }
      throw new Error(`下到的内容不是音频（已丢弃临时文件）：${describeNonAudio(head)}`)
    }

    /**
     * 3.5) 定下最终文件名。
     *
     * 规划阶段扩展名被硬编码成 .mp3（真实容器要等取流后才知道），
     * 所以「这个名字被占了吗」是在错误的扩展名下判断的。这里按真实格式再核一遍：
     * 目标要么被别的任务占着，要么在非覆盖语义下已经存在 ——
     * 两种情况都必须让开，绝不删掉别人（或用户自己）的成品。
     */
    const want = task.savePath.replace(/\.[^.\\/]+$/, `.${format.ext}`)
    const mismatch = extMismatch(task.savePath.split('.').pop() ?? '', format)
    if (mismatch) {
      this.deps.onLog?.('warn', 'download', `${task.fileName}: ${mismatch}，已按真实格式改正`)
    }
    const overwriteMode = config.conflict === 'overwrite'
    const blocked =
      this.claimedByOtherTask(want, task.id) ||
      this.heldByActive(want, task.id) ||
      (!overwriteMode && existsSync(want))
    const target = blocked ? this.freePath(want, task.id) : want
    if (target !== task.savePath) {
      this.deps.onLog?.(
        'warn',
        'download',
        `${task.fileName} → ${target.slice(target.lastIndexOf(sep) + 1)}（避免覆盖已有文件）`
      )
    }
    task.savePath = target
    task.fileName = target.slice(target.lastIndexOf(sep) + 1)

    // 4) 落盘。到这里手上已经有「确认是音频」的 .part 了，覆盖才是安全的
    if (existsSync(task.savePath)) rmSync(task.savePath, { force: true })
    renameSync(partPath, task.savePath)

    // 5) 写标签（失败不影响下载结果）
    if (task.writeTag && config.writeTag) {
      try {
        /**
         * 平台没给封面时，跨平台补一张再嵌进去。
         * 酷我等平台的搜索结果本来就常常没有封面地址 ——
         * 不补的话下载下来的文件在播放器里就是一片空白。
         */
        let coverUrl = task.song.picUrl
        if (config.downloadCover && !coverUrl) {
          try {
            const found = await resolveCover(task.song)
            if (found) {
              coverUrl = found
              this.deps.onLog?.('info', 'download', `${task.fileName}: 平台没给封面，已补一张`)
            }
          } catch {
            /* 补不到就不嵌封面 */
          }
        }

        await writeAudioTag(task.savePath, {
          title: task.song.name,
          artist: task.song.singer,
          album: task.song.albumName,
          // 专辑艺术家用主歌手：合唱曲才不会把一张专辑拆成好几张
          albumArtist: String(task.song.singer ?? '').split(/[&、/]/)[0]?.trim() || task.song.singer,
          year: this.pickYear(task.song),
          coverUrl: config.downloadCover ? coverUrl : undefined,
          comment: `MusicHub · ${PLATFORM_META[task.song.platform]?.name ?? task.song.platform}`
        })
      } catch (err) {
        this.deps.onLog?.('warn', 'download', `写入标签失败（不影响文件）: ${errMsg(err)}`)
      }
    }
  }

  /** 读文件开头若干字节，用于格式校验 */
  private readHead(filePath: string, bytes: number): Buffer {
    try {
      const fd = openSync(filePath, 'r')
      const buf = Buffer.alloc(bytes)
      const read = readSync(fd, buf, 0, bytes, 0)
      closeSync(fd)
      return read === bytes ? buf : buf.subarray(0, Math.max(0, read))
    } catch {
      return Buffer.alloc(0)
    }
  }

  /** 从平台原始字段里碰运气找年份（各平台字段名不统一） */
  private pickYear(song: Song): number | undefined {
    const raw = (song.raw ?? {}) as Record<string, unknown>
    const candidates = [raw.publishTime, raw.releaseDate, raw.pubtime, raw.year, raw.issue]
    for (const c of candidates) {
      const text = typeof c === 'string' ? c : typeof c === 'number' ? String(c) : ''
      const m = /(19|20)\d{2}/.exec(text)
      if (m) return Number(m[0])
    }
    return undefined
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

  /**
   * 「这个路径现在能不能用」的判定。
   *
   * 三种占用来源缺一不可：
   *  1. 其它任务已规划/已落盘的路径 —— 磁盘上可能还没有文件，但马上就会有，
   *     只看 existsSync 会漏掉并发这一整类冲突（这正是文件名互相覆盖的根源）；
   *  2. 磁盘上已存在的正式文件；
   *  3. 磁盘上已存在的 .part（上次中断留下的，续传要用，不能被顶掉）。
   */
  private occupancy(selfId?: string): (p: string) => boolean {
    const claimed = new Set<string>()
    for (const t of this.tasks.values()) {
      if (t.id === selfId) continue
      claimed.add(pathKey(t.savePath))
    }
    return (p: string): boolean =>
      claimed.has(pathKey(p)) || existsSync(p) || existsSync(`${p}.part`)
  }

  /** 给 desired 找一个真正空闲的路径（同目录内递增序号，保留扩展名） */
  private freePath(desired: string, selfId?: string): string {
    const taken = this.occupancy(selfId)
    if (!taken(desired)) return desired
    const m = /^(.*?)(\.[^./\\]+)$/.exec(desired)
    const stem = m ? m[1] : desired
    const ext = m ? m[2] : ''
    let i = 1
    let p = `${stem} (${i})${ext}`
    while (taken(p) && i < 500) {
      i += 1
      p = `${stem} (${i})${ext}`
    }
    return p
  }

  /** 该路径是否正被「其它在途任务」占用（不管磁盘上有没有东西） */
  private heldByActive(p: string, selfId?: string): boolean {
    const key = pathKey(p)
    for (const t of this.tasks.values()) {
      if (t.id === selfId) continue
      if (
        t.status === 'waiting' ||
        t.status === 'pending' ||
        t.status === 'downloading' ||
        t.status === 'paused'
      ) {
        if (pathKey(t.savePath) === key) return true
      }
    }
    return false
  }

  /**
   * 该路径是否已经被「别的任务」认领（不论那个任务处于什么状态）。
   *
   * 比 heldByActive 更严：一条任务只要记着这个路径，别的任务就不该染指。
   * 只用「在途状态」判断会漏掉一个窗口 —— 对方刚下完、状态已经变成 done，
   * 而文件正好在这一瞬被写出来，检查落空，随后 rmSync 就把它的成品删了。
   */
  private claimedByOtherTask(p: string, selfId?: string): boolean {
    const key = pathKey(p)
    for (const t of this.tasks.values()) {
      if (t.id === selfId) continue
      if (pathKey(t.savePath) === key) return true
    }
    return false
  }

  /**
   * 任务专属的临时文件路径。
   *
   * 带上任务 id，保证任何情况下都不会有两个任务共用同一个 .part
   * ——共用会让并发写入互相截断，续传时还会把另一首歌的字节接在后面，成品必坏。
   * 同时它由「当前 savePath」推导，所以音质/容器变化导致路径变化时会自然换用
   * 新的临时文件，绝不会把上一轮的残片接着往下写。
   */
  private partPathOf(task: DownloadTask): string {
    return `${task.savePath}.${task.id.slice(0, 8)}.part`
  }

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

    const taken = this.occupancy()
    if (!taken(savePath)) return { fileName, savePath }

    // 覆盖 / 跳过只对「磁盘上已有的历史文件」有意义；别的任务认领了就必须让开
    if (
      !this.claimedByOtherTask(savePath) &&
      (config.conflict === 'overwrite' || config.conflict === 'skip')
    ) {
      return { fileName, savePath }
    }

    savePath = this.freePath(savePath)
    fileName = savePath.slice(savePath.lastIndexOf(sep) + 1)
    return { fileName, savePath }
  }
}

/* ------------------------------ 工具 ------------------------------ */

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 路径比较用键：Windows 文件系统不区分大小写，必须归一化后再比 */
function pathKey(p: string): string {
  const n = normalize(resolve(p))
  return process.platform === 'win32' ? n.toLowerCase() : n
}

/** 判断 target 是否在 dir 目录之内（用于「绝不删下载目录以外的文件」） */
function isInsideDir(target: string, dir: string): boolean {
  const d = pathKey(dir)
  const t = pathKey(target)
  return t === d || t.startsWith(d.endsWith(sep) ? d : d + sep)
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
