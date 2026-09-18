/**
 * 端到端链路验证
 *
 * 验证的是这个软件真正的命门：**搜索 → 取流 → 地址能播**。
 * 三件事分别对应三个核心模块，任何一环断了软件就是废的。
 *
 * 这里跑的是真实模块（不是复刻逻辑）：
 *   SourceManager（音源装载）→ SearchEngine（聚合搜索）
 *   → MusicResolver（音源择优取流）→ StreamProxy（本地代理）
 *
 * 运行： npm run verify:pipeline [关键词]
 */
import { join } from 'node:path'
import { SourceManager } from '@main/core/source/manager'
import { SearchEngine } from '@main/core/search/engine'
import { MusicResolver } from '@main/core/source/resolver'
import { StreamProxy } from '@main/core/proxy/stream-proxy'

/**
 * 音源脚本常带后台轮询，其异步异常会逃逸到宿主事件循环。
 * 真实应用有全局兜底（见 src/main/index.ts），验证脚本同样需要，
 * 否则一个坏音源就会让整轮验证中断。
 */
process.on('uncaughtException', (err) => {
  console.log(`   [脚本异步异常] ${err.message}`)
})
process.on('unhandledRejection', (reason) => {
  const msg = reason && typeof reason === 'object' && 'message' in reason
    ? String((reason as { message: unknown }).message)
    : String(reason)
  console.log(`   [未处理的 Promise 拒绝] ${msg}`)
})

const keyword = process.argv[2] ?? '晴天'
const userData = join(process.env.APPDATA ?? '', 'MusicHub')
const sourceDir = join(userData, 'sources')

const log = (level: string, scope: string, message: string): void => {
  if (level !== 'info') console.log(`   [${level}] ${scope}: ${message}`)
}

console.log(`\n${'='.repeat(78)}`)
console.log(`MusicHub 端到端链路验证`)
console.log(`${'='.repeat(78)}`)
console.log(`音源目录: ${sourceDir}\n`)

/* ------------------------------ 1. 音源装载 ------------------------------ */

const proxy = new StreamProxy()
const port = await proxy.start(0)
console.log(`[1] 本地流代理已启动: http://127.0.0.1:${port}`)

const sources = new SourceManager({
  sourceDir,
  stateFile: join(userData, 'source-state.json'),
  version: '2.7.0',
  onLog: log
})

const t0 = Date.now()
await sources.init()
const all = sources.list()
const ready = all.filter((s) => s.status === 'ready')
console.log(`[2] 音源装载: ${ready.length}/${all.length} 可用 (${Date.now() - t0}ms)`)

// 各平台各有多少音源支持
const platformCount = new Map<string, number>()
for (const src of ready) {
  if (!src.enabled) continue
  for (const p of src.platforms) platformCount.set(p, (platformCount.get(p) ?? 0) + 1)
}
console.log(
  `    平台覆盖: ${[...platformCount.entries()]
    .sort()
    .map(([p, n]) => `${p}=${n}个源`)
    .join('  ')}`
)

/* ------------------------------ 2. 搜索 ------------------------------ */

const search = new SearchEngine({ sources, onLog: log })
const resolver = new MusicResolver({ sources, proxy, onLog: log })

const t1 = Date.now()
const res = await search.search({ keyword, limit: 5 })
console.log(`\n[3] 聚合搜索「${keyword}」: 耗时 ${res.cost}ms`)
for (const p of res.platforms) {
  const flag = p.songs.length > 0 ? '✓' : '✗'
  console.log(
    `    ${flag} ${p.providerName.padEnd(10)} ${String(p.songs.length).padStart(2)} 条` +
      (p.error ? `  [${p.error}]` : '')
  )
}

/* ------------------------------ 3. 取流 + 可用性 ------------------------------ */

// 每个平台取 2 首：第 2 首用来观察「失败记忆」是否生效 —— 应当显著快于第 1 首
const targets = res.platforms
  .filter((p) => p.songs.length > 0)
  .flatMap((p) => p.songs.slice(0, 2))

console.log(`\n[4] 取流并验证可播放性（每平台抽 2 首，共 ${targets.length} 首）`)

let okCount = 0

for (const song of targets) {
  const started = Date.now()
  try {
    const result = await resolver.resolve({ song })

    // 对拿到的代理地址做一次真实请求，确认真的能取到音频数据
    let verdict = ''
    try {
      const probe = await fetch(result.url, {
        headers: { Range: 'bytes=0-1023' },
        signal: AbortSignal.timeout(15000)
      })
      const bytes = (await probe.arrayBuffer()).byteLength
      const type = probe.headers.get('content-type') ?? '未知类型'
      verdict = `HTTP ${probe.status} · ${type} · 读到 ${bytes} 字节`
      if (probe.ok || probe.status === 206) okCount += 1
    } catch (err) {
      verdict = `探测失败: ${err instanceof Error ? err.message : String(err)}`
    }

    console.log(`\n    ✓ [${song.platform}] ${song.name} — ${song.singer}`)
    console.log(`        音源: ${result.sourceName}   音质: ${result.quality}   耗时: ${Date.now() - started}ms`)
    console.log(`        校验: ${verdict}`)
    if (result.attempts.length > 1) {
      const failed = result.attempts.filter((a) => !a.ok)
      if (failed.length > 0) {
        console.log(`        失败源: ${failed.map((a) => a.sourceName).join(', ')}`)
      }
    }
  } catch (err) {
    console.log(`\n    ✗ [${song.platform}] ${song.name} — 取流失败`)
    console.log(`        ${err instanceof Error ? err.message : String(err)}`)
  }
}

/* ------------------------------ 5. 歌词 ------------------------------ */

console.log(`\n[5] 歌词获取测试`)
const lyricTarget = targets[0]
if (lyricTarget) {
  const lyric = await resolver.getLyric(lyricTarget)
  if (lyric) {
    const text = lyric.lyric || lyric.lxlyric || ''
    console.log(`    ✓ 拿到歌词：主歌词 ${text.length} 字符，来源音源 id=${lyric.sourceId ?? '未知'}`)
    console.log(`    预览：${text.split('\n').slice(0, 3).join(' / ').slice(0, 100)}`)
  } else {
    console.log(`    ✗ 所有音源都没提供歌词`)
    const capable = sources
      .list()
      .filter(
        (s) =>
          s.status === 'ready' &&
          s.capabilities.some(
            (c) => c.platform === lyricTarget.platform && c.actions.includes('lyric')
          )
      )
    console.log(
      `    声明支持「${lyricTarget.platform}」歌词的音源：${
        capable.length > 0 ? capable.map((s) => s.name).join(', ') : '（一个都没有）'
      }`
    )
  }
}

/* ------------------------------ 汇总 ------------------------------ */

console.log(`\n${'='.repeat(78)}`)
console.log(
  `汇总: 音源 ${ready.length}/${all.length} 可用 · 搜索命中 ${res.platforms.reduce((a, p) => a + p.songs.length, 0)} 条 · ` +
    `可播放地址 ${okCount}/${targets.length}`
)
console.log(`${'='.repeat(78)}\n`)

sources.dispose()
await proxy.stop()
process.exit(0)
