/**
 * 音源管理器
 *
 * 职责：
 *  - 导入音源脚本（文件 / URL / 内置目录）并落盘到 userData/sources
 *  - 在沙箱中执行脚本，完成协议握手（洛雪 send('inited') / MusicFree module.exports）
 *  - 维护启用状态与可用性统计
 *  - 对外提供「按能力筛选音源」的查询接口，供取流调度器使用
 */
import { EventEmitter } from 'node:events'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

import type { PlatformId, Quality } from '@shared/types/music'
import type {
  SourceAction,
  SourceCapability,
  SourceFormat,
  SourceImportResult,
  SourceInfo
} from '@shared/types/source'
import { APP_CONST, qualityRank } from '@shared/constants'

import { LxRuntime, type LxHostAdapter, type LxInitedPayload, type LxLogLevel } from './lx-protocol'
import { SourceSandbox } from './sandbox'
import { detectSourceFormat, hashCode, parseSourceMeta, safeDisplayName } from './parser'
import { httpRequest } from '../net/http'
import { JsonStore } from '../storage/store'

/** 音源状态持久化结构 */
interface SourceState {
  /** id -> 是否启用 */
  enabled: Record<string, boolean>
}

/** 一个已加载音源的内部记录 */
export interface LoadedSource {
  id: string
  info: SourceInfo
  sandbox: SourceSandbox
  lxRuntime: LxRuntime | null
  /** 脚本 CommonJS 导出（MusicFree 格式） */
  exports: unknown
  /** 洛雪协议握手结果 */
  inited: LxInitedPayload | null
}

export interface SourceManagerDeps {
  /** 音源文件存放目录 */
  sourceDir: string
  /** 内置音源目录（随应用分发） */
  bundledDir?: string
  /** 状态文件路径 */
  stateFile: string
  /** 宿主版本，暴露给脚本做版本判断 */
  version: string
  /** 日志出口 */
  onLog?: (level: 'info' | 'warn' | 'error', scope: string, message: string) => void
}

/** 可执行的脚本扩展名 */
const SCRIPT_EXT = new Set(['.js', '.mjs', '.cjs', '.txt'])

export class SourceManager extends EventEmitter {
  private readonly deps: SourceManagerDeps
  private readonly sources = new Map<string, LoadedSource>()
  private readonly state: JsonStore<SourceState>

  constructor(deps: SourceManagerDeps) {
    super()
    this.deps = deps
    this.state = new JsonStore<SourceState>(deps.stateFile, { enabled: {} })
    if (!existsSync(deps.sourceDir)) mkdirSync(deps.sourceDir, { recursive: true })
  }

  /* ------------------------------ 对外 API ------------------------------ */

  /** 启动时从磁盘装载全部音源 */
  async init(): Promise<void> {
    const files = this.listScriptFiles(this.deps.sourceDir)
    this.log('info', `发现 ${files.length} 个本地音源脚本`)
    for (const file of files) {
      try {
        await this.loadFile(file)
      } catch (err) {
        this.log('error', `装载失败 ${basename(file)}: ${errMsg(err)}`)
      }
    }
    this.emitChanged()
  }

  /** 全部音源视图 */
  list(): SourceInfo[] {
    const enabled = this.state.get().enabled
    return [...this.sources.values()]
      .map((s) => ({ ...s.info, enabled: enabled[s.id] ?? true }))
      .sort((a, b) => {
        // 可用的排前面，其次按名字
        const sa = a.status === 'ready' ? 0 : 1
        const sb = b.status === 'ready' ? 0 : 1
        if (sa !== sb) return sa - sb
        return a.name.localeCompare(b.name, 'zh-CN')
      })
  }

  /** 取原始内部记录（取流调度器用） */
  get(id: string): LoadedSource | undefined {
    return this.sources.get(id)
  }

  /** 全部已加载记录 */
  all(): LoadedSource[] {
    return [...this.sources.values()]
  }

  /** 判断音源是否启用 */
  isEnabled(id: string): boolean {
    return this.state.get().enabled[id] ?? true
  }

  /**
   * 短期失败记忆：`sourceId:platform` → 冷却截止时间戳。
   *
   * 某些音源在特定平台上会反复失败而且很慢（内部要把所有 API、所有音质都试一遍，
   * 单个源能拖掉几十秒）。记住这类失败，可以避免每首歌都重走同一条死路 ——
   * 这是「取流从 90 秒降到几秒」的关键。
   */
  private readonly cooldowns = new Map<string, number>()

  /**
   * 找出能处理指定平台 + action 的启用音源。
   * @param platform 目标平台
   * @param action   需要的 action
   * @param minQuality 最低音质要求（可选）
   */
  findCapable(platform: PlatformId, action: SourceAction, minQuality?: Quality): LoadedSource[] {
    const min = minQuality ? qualityRank(minQuality) : 0
    const result: LoadedSource[] = []

    for (const src of this.sources.values()) {
      if (src.info.status !== 'ready') continue
      if (!this.isEnabled(src.id)) continue
      // 刚在这个平台上失败过的音源先跳过
      if (this.isCoolingDown(src.id, platform)) continue
      const cap = src.info.capabilities.find((c) => c.platform === platform)
      if (!cap) continue
      if (!cap.actions.includes(action)) continue
      if (action === 'musicUrl' && min > 0) {
        const best = cap.qualities.reduce((acc, q) => Math.max(acc, qualityRank(q)), 0)
        // 音源没声明音质时不做拦截，交由运行时判定
        if (cap.qualities.length > 0 && best < min) continue
      }
      result.push(src)
    }

    // 排序：成功率高的优先，其次连续失败少的、响应快的
    return result.sort((a, b) => this.score(b) - this.score(a))
  }

  /** 某音源在某平台是否处于失败冷却期 */
  isCoolingDown(sourceId: string, platform: string): boolean {
    const key = `${sourceId}:${platform}`
    const until = this.cooldowns.get(key)
    if (until === undefined) return false
    if (Date.now() >= until) {
      this.cooldowns.delete(key)
      return false
    }
    return true
  }

  /**
   * 记一次失败冷却。
   * 连续失败越多冷却越久（指数退避，封顶 10 分钟），
   * 让反复挂掉的音源自动淡出调度，而单次偶发失败不会误伤。
   */
  markCooldown(sourceId: string, platform: string): void {
    const src = this.sources.get(sourceId)
    const fails = Math.max(1, src?.info.stat.consecutiveFail ?? 1)
    const ms = Math.min(60_000 * 2 ** Math.min(fails - 1, 3), 600_000)
    this.cooldowns.set(`${sourceId}:${platform}`, Date.now() + ms)
  }

  /** 清空冷却（手动重载/重试时用，给用户一个「再试一次」的出口） */
  clearCooldown(sourceId?: string): void {
    if (!sourceId) {
      this.cooldowns.clear()
      return
    }
    for (const key of [...this.cooldowns.keys()]) {
      if (key.startsWith(`${sourceId}:`)) this.cooldowns.delete(key)
    }
  }

  /** 当前处于冷却期的音源数量，供诊断展示 */
  get cooldownCount(): number {
    const now = Date.now()
    let count = 0
    for (const until of this.cooldowns.values()) {
      if (until > now) count += 1
    }
    return count
  }

  /** 综合可用性评分，用于取流择优 */
  private score(src: LoadedSource): number {
    const { success, fail, consecutiveFail, lastCost } = src.info.stat
    const total = success + fail
    const rate = total === 0 ? 0.5 : success / total
    let score = rate * 100
    score -= consecutiveFail * 25
    if (lastCost !== undefined) score -= Math.min(lastCost / 200, 20)
    // 声明支持无损的音源，在同一平台内略有优势
    if ((src.info.maxQuality && qualityRank(src.info.maxQuality) >= 40)) score += 5
    return score
  }

  /* ------------------------------ 导入 ------------------------------ */

  /** 从若干文件路径导入 */
  async importFiles(paths: string[]): Promise<SourceImportResult> {
    const result: SourceImportResult = { imported: [], failed: [], skipped: [] }

    for (const input of paths) {
      try {
        const abs = resolve(input)
        if (!existsSync(abs) || !statSync(abs).isFile()) {
          result.failed.push({ path: input, error: '文件不存在' })
          continue
        }
        if (!SCRIPT_EXT.has(extname(abs).toLowerCase())) {
          result.failed.push({ path: input, error: '仅支持 .js / .mjs / .cjs / .txt 脚本' })
          continue
        }

        const code = readFileSync(abs, 'utf8')
        const hash = hashCode(code)

        // 已存在同内容音源 → 跳过
        const dup = [...this.sources.values()].find((s) => s.info.hash === hash)
        if (dup) {
          result.skipped.push(`${basename(abs)}（与「${dup.info.name}」内容相同）`)
          continue
        }

        // 复制进音源目录（外部文件才需要复制）
        const targetName = this.uniqueFileName(basename(abs))
        const targetPath = join(this.deps.sourceDir, targetName)
        if (resolve(targetPath) !== abs) copyFileSync(abs, targetPath)

        const loaded = await this.loadFile(targetPath)
        result.imported.push(loaded.info)
      } catch (err) {
        result.failed.push({ path: input, error: errMsg(err) })
      }
    }

    this.emitChanged()
    return result
  }

  /** 从 URL 下载并导入音源 */
  async importFromUrl(url: string): Promise<SourceImportResult> {
    const result: SourceImportResult = { imported: [], failed: [], skipped: [] }
    try {
      const resp = await httpRequest(url, { method: 'GET', timeout: 20000 })
      const code = typeof resp.body === 'string' ? resp.body : resp.raw.toString('utf8')
      if (!code.trim()) throw new Error('远程内容为空')

      const fileName = this.deriveNameFromUrl(url, code)
      const targetPath = join(this.deps.sourceDir, this.uniqueFileName(fileName))
      writeFileSync(targetPath, code, 'utf8')

      const loaded = await this.loadFile(targetPath)
      result.imported.push(loaded.info)
      this.log('info', `从 URL 导入成功: ${loaded.info.name}`)
    } catch (err) {
      result.failed.push({ path: url, error: errMsg(err) })
    }
    this.emitChanged()
    return result
  }

  /** 导入随应用分发的内置音源（首次启动用） */
  async importBundled(): Promise<SourceImportResult> {
    const result: SourceImportResult = { imported: [], failed: [], skipped: [] }
    const dir = this.deps.bundledDir
    if (!dir || !existsSync(dir)) return result

    const files = this.listScriptFiles(dir)
    for (const file of files) {
      try {
        const code = readFileSync(file, 'utf8')
        const hash = hashCode(code)
        if ([...this.sources.values()].some((s) => s.info.hash === hash)) {
          result.skipped.push(basename(file))
          continue
        }
        const targetPath = join(this.deps.sourceDir, this.uniqueFileName(basename(file)))
        writeFileSync(targetPath, code, 'utf8')
        const loaded = await this.loadFile(targetPath)
        result.imported.push(loaded.info)
      } catch (err) {
        result.failed.push({ path: file, error: errMsg(err) })
      }
    }
    this.emitChanged()
    return result
  }

  /* ------------------------------ 管理 ------------------------------ */

  /** 删除音源（连同磁盘文件） */
  async remove(ids: string[]): Promise<void> {
    for (const id of ids) {
      const src = this.sources.get(id)
      if (!src) continue
      src.sandbox.dispose()
      src.lxRuntime?.dispose()
      try {
        if (existsSync(src.info.path)) rmSync(src.info.path, { force: true })
      } catch {
        /* 文件可能已被手动删除 */
      }
      this.sources.delete(id)
    }
    const enabled = { ...this.state.get().enabled }
    for (const id of ids) delete enabled[id]
    this.state.set({ enabled })
    this.emitChanged()
  }

  /** 启用 / 禁用 */
  async toggle(id: string, enabled: boolean): Promise<SourceInfo> {
    const src = this.sources.get(id)
    if (!src) throw new Error(`音源不存在: ${id}`)
    this.state.set({ enabled: { ...this.state.get().enabled, [id]: enabled } })
    this.emitChanged()
    return { ...src.info, enabled }
  }

  /** 重新加载指定音源（脚本改动后） */
  async reload(id: string): Promise<SourceInfo> {
    const src = this.sources.get(id)
    if (!src) throw new Error(`音源不存在: ${id}`)
    const file = src.info.path
    src.sandbox.dispose()
    src.lxRuntime?.dispose()
    this.sources.delete(id)
    const loaded = await this.loadFile(file)
    this.emitChanged()
    return loaded.info
  }

  /** 读取脚本源码 */
  readSource(id: string): string {
    const src = this.sources.get(id)
    if (!src) throw new Error(`音源不存在: ${id}`)
    return readFileSync(src.info.path, 'utf8')
  }

  /** 写入脚本并重载 */
  async writeSource(id: string, code: string): Promise<SourceInfo> {
    const src = this.sources.get(id)
    if (!src) throw new Error(`音源不存在: ${id}`)
    writeFileSync(src.info.path, code, 'utf8')
    return this.reload(id)
  }

  /** 记录一次取流结果，用于动态排序 */
  recordStat(id: string, ok: boolean, cost: number, error?: string): void {
    const src = this.sources.get(id)
    if (!src) return
    const stat = src.info.stat
    if (ok) {
      stat.success += 1
      stat.consecutiveFail = 0
      stat.lastCost = cost
      stat.lastSuccessAt = Date.now()
    } else {
      stat.fail += 1
      stat.consecutiveFail += 1
      if (error) src.info.error = error
    }
  }

  /** 进程退出前清理 */
  dispose(): void {
    for (const src of this.sources.values()) {
      src.sandbox.dispose()
      src.lxRuntime?.dispose()
    }
    this.sources.clear()
    this.state.flush()
  }

  /* ------------------------------ 加载核心 ------------------------------ */

  /** 加载单个脚本文件：解析 → 执行 → 握手 → 建视图 */
  private async loadFile(filePath: string): Promise<LoadedSource> {
    const code = readFileSync(filePath, 'utf8')
    const fileName = basename(filePath)
    const meta = parseSourceMeta(code, fileName)
    const staticFormat = detectSourceFormat(code)
    const hash = hashCode(code)
    const id = this.makeId(fileName, hash)

    const logs: string[] = []
    const info: SourceInfo = {
      id,
      name: safeDisplayName(meta.name, fileName),
      description: meta.description,
      version: meta.version,
      author: meta.author,
      repository: meta.repository,
      format: (staticFormat === 'unknown' ? 'lx' : staticFormat) as SourceFormat,
      status: 'loading',
      enabled: this.isEnabled(id),
      path: filePath,
      hash,
      size: Buffer.byteLength(code, 'utf8'),
      capabilities: [],
      platforms: [],
      logs,
      stat: { success: 0, fail: 0, consecutiveFail: 0 }
    }

    // 洛雪运行时：脚本里的 HTTP 请求一律由宿主代发
    const lxRuntime = new LxRuntime({
      host: this.createHostAdapter(info, logs),
      requestTimeout: APP_CONST.fetchTimeout + 5000,
      // 部分音源会读 lx.currentScriptInfo 来构造请求头，缺失会直接抛错
      scriptInfo: {
        name: info.name,
        description: meta.description ?? '',
        version: meta.version ?? '',
        author: meta.author ?? '',
        homepage: meta.repository ?? '',
        rawScript: code
      }
    })

    const sandbox = new SourceSandbox({
      filename: fileName,
      code,
      lxRuntime,
      onLog: (level, args) => this.captureLog(info, logs, level, args),
      runTimeoutMs: APP_CONST.sourceInitTimeout
    })

    let exportsValue: unknown = null
    try {
      const result = sandbox.run()
      exportsValue = result.moduleExports
      // 异步赋值 exports 的脚本，稍后再读一次
      if (!exportsValue || Object.keys(exportsValue as object).length === 0) {
        exportsValue = sandbox.readExports()
      }
      if (result.error && !lxRuntime.isInited && !hasExportHooks(exportsValue)) {
        info.status = 'error'
        info.error = result.error.split('\n')[0]
      }
    } catch (err) {
      info.status = 'error'
      info.error = errMsg(err)
    }

    // 等待协议握手。
    // 脚本若已在同步阶段抛错，只给极短窗口 —— 否则一个坏音源就要干等满超时，
    // 几十个音源累积起来会把启动拖到几分钟。
    const inited = await this.waitForInited(
      lxRuntime,
      info.status === 'error' ? 800 : undefined
    )

    if (info.status !== 'error') {
      if (inited && inited.status !== false && inited.status !== 'fail') {
        info.format = 'lx'
        info.capabilities = this.buildCapabilities(inited)
        info.status = info.capabilities.length > 0 ? 'ready' : 'error'
        if (!info.capabilities.length) info.error = '脚本未上报任何可用平台'
      } else if (hasExportHooks(exportsValue)) {
        // MusicFree 插件：能力来自导出对象
        info.format = 'musicfree'
        const caps = buildMusicFreeCapabilities(exportsValue)
        info.capabilities = caps
        info.status = caps.length > 0 ? 'ready' : 'error'
        if (!caps.length) info.error = '插件未声明 platform'
      } else {
        info.status = 'error'
        info.error = info.error ?? '音源初始化失败（未上报 inited，且无有效导出）'
      }
    }

    info.platforms = [...new Set(info.capabilities.map((c) => c.platform))]
    info.maxQuality = pickMaxQuality(info.capabilities)
    info.loadedAt = Date.now()

    const loaded: LoadedSource = { id, info, sandbox, lxRuntime, exports: exportsValue, inited }
    this.sources.set(id, loaded)

    if (info.status === 'ready') {
      this.log(
        'info',
        `已加载「${info.name}」 平台[${info.platforms.join(',')}] 最高音质 ${info.maxQuality ?? '未知'}`
      )
    } else {
      this.log('warn', `音源加载失败「${info.name}」: ${info.error ?? '未知原因'}`)
    }

    return loaded
  }

  /** 构造洛雪宿主适配器 */
  private createHostAdapter(info: SourceInfo, logs: string[]): LxHostAdapter {
    return {
      version: this.deps.version,
      env: 'desktop',
      httpRequest: (url, options) => httpRequest(url, options),
      onInited: () => {
        /* 由 waitForInited 统一读取，这里不必处理 */
      },
      onUpdateAlert: (payload) => {
        const p = payload as { log?: string; updateUrl?: string }
        if (p?.log) this.captureLog(info, logs, 'info', [p.log])
      },
      onLog: (level, args) => this.captureLog(info, logs, level, args)
    }
  }

  /** 等待脚本完成 inited 上报 */
  private waitForInited(
    runtime: LxRuntime,
    timeoutMs: number = APP_CONST.sourceInitTimeout
  ): Promise<LxInitedPayload | null> {
    if (runtime.isInited) return Promise.resolve(runtime.initPayload)
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs
      const timer = setInterval(() => {
        if (runtime.isInited) {
          clearInterval(timer)
          resolve(runtime.initPayload)
        } else if (Date.now() > deadline) {
          clearInterval(timer)
          resolve(null)
        }
      }, 40)
    })
  }

  /** 把 inited 上报转成能力视图 */
  private buildCapabilities(inited: LxInitedPayload): SourceCapability[] {
    const out: SourceCapability[] = []
    const sourcesObj = inited?.sources ?? {}
    for (const [platform, s] of Object.entries(sourcesObj)) {
      if (!s) continue
      // 只认 music 类型；洛雪另有 'pic'/'lyric' 类型源，这里跳过非音乐源
      if (s.type && s.type !== 'music') continue
      out.push({
        platform,
        name: s.name || platform,
        actions: normalizeActions(s.actions),
        qualities: normalizeQualities(s.qualitys)
      })
    }
    return out
  }

  /** 日志采集：内存里保留尾部若干条，便于 UI 展示 */
  private captureLog(
    info: SourceInfo,
    logs: string[],
    level: LxLogLevel,
    args: unknown[]
  ): void {
    const line = args.map((a) => stringifyArg(a)).join(' ')
    logs.push(line)
    if (logs.length > 80) logs.splice(0, logs.length - 80)
    info.logs = logs
    if (level === 'error') this.deps.onLog?.('error', info.name, line)
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.deps.onLog?.(level, 'source', message)
  }

  private emitChanged(): void {
    this.emit('changed', this.list())
  }

  /** 列出目录下所有脚本文件 */
  private listScriptFiles(dir: string): string[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => SCRIPT_EXT.has(extname(f).toLowerCase()))
      .map((f) => join(dir, f))
      .sort()
  }

  /** 生成稳定 id（基于文件名，脚本更新后 id 不变） */
  private makeId(fileName: string, hash: string): string {
    const base = createHash('sha1').update(fileName).digest('hex').slice(0, 10)
    // 文件名相同但内容不同时（覆盖更新）保持 id，因此 hash 不进 id
    void hash
    return `src_${base}`
  }

  /** 目录内避免重名 */
  private uniqueFileName(name: string): string {
    const normalized = name.replace(/[\\/:*?"<>|]/g, '_')
    let candidate = normalized
    let i = 2
    while (existsSync(join(this.deps.sourceDir, candidate))) {
      const ext = extname(normalized)
      candidate = `${normalized.slice(0, -ext.length)} (${i})${ext}`
      i += 1
      if (i > 200) break
    }
    return candidate
  }

  /** 从 URL 猜文件名 */
  private deriveNameFromUrl(url: string, code: string): string {
    try {
      const pathname = new URL(url).pathname
      const base = basename(pathname)
      if (base && SCRIPT_EXT.has(extname(base).toLowerCase())) return decodeURIComponent(base)
    } catch {
      /* 落到下面的兜底 */
    }
    const meta = parseSourceMeta(code)
    return `${meta.name ?? 'source'}.js`
  }
}

/* ------------------------------ 工具函数 ------------------------------ */

/**
 * 取错误信息。
 * 不用 `instanceof Error`：vm 沙箱里抛出的 Error 来自另一个 realm，
 * 构造器与宿主不同，instanceof 会漏判并丢掉 message。
 */
function errMsg(err: unknown): string {
  if (err && typeof err === 'object') {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return String(err)
}

/** 参数安全转字符串（日志用，避免循环引用炸掉） */
function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.message
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

/** 规范化 action 列表 */
function normalizeActions(actions: unknown): SourceAction[] {
  if (!Array.isArray(actions)) return []
  const valid: SourceAction[] = ['musicUrl', 'lyric', 'pic', 'musicSearch']
  return actions.filter((a): a is SourceAction => typeof a === 'string' && valid.includes(a as SourceAction))
}

/** 规范化音质列表（去重 + 降序） */
function normalizeQualities(qualities: unknown): Quality[] {
  if (!Array.isArray(qualities)) return []
  const set = new Set<string>()
  for (const q of qualities) {
    if (typeof q === 'string' && q) set.add(q)
  }
  return [...set].sort((a, b) => qualityRank(b) - qualityRank(a))
}

/** 能力里最高的音质 */
function pickMaxQuality(caps: SourceCapability[]): Quality | undefined {
  let best: Quality | undefined
  let bestRank = 0
  for (const cap of caps) {
    for (const q of cap.qualities) {
      const rank = qualityRank(q)
      if (rank > bestRank) {
        bestRank = rank
        best = q
      }
    }
  }
  return best
}

/** 判断 CommonJS 导出是否为 MusicFree 插件 */
function hasExportHooks(exportsValue: unknown): boolean {
  if (!exportsValue || typeof exportsValue !== 'object') return false
  const obj = exportsValue as Record<string, unknown>
  return typeof obj.getMediaSource === 'function' || typeof obj.search === 'function'
}

/** 由 MusicFree 插件导出构建能力视图 */
function buildMusicFreeCapabilities(exportsValue: unknown): SourceCapability[] {
  const plugin = exportsValue as Record<string, unknown>
  if (!plugin || typeof plugin !== 'object') return []
  const platform = typeof plugin.platform === 'string' ? plugin.platform : undefined
  if (!platform) return []
  const actions: SourceAction[] = []
  if (typeof plugin.getMediaSource === 'function') actions.push('musicUrl')
  if (typeof plugin.search === 'function') actions.push('musicSearch')
  if (typeof plugin.getLyric === 'function') actions.push('lyric')

  const qualitys = Array.isArray(plugin.qualitys)
    ? plugin.qualitys
    : ['128k', '320k', 'flac']

  return [
    {
      platform,
      name: typeof plugin.name === 'string' ? plugin.name : platform,
      actions,
      qualities: normalizeQualities(qualitys)
    }
  ]
}
