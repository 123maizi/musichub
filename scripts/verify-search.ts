/**
 * 搜索映射端到端验证
 * 直接跑真实的 Provider 代码，打印归一化后的 Song，确认字段映射正确。
 *
 * 运行方式（见 package.json scripts.verify:search）：
 *   esbuild 打包后交给 node 执行，保证验证的是真实代码路径而不是复刻逻辑。
 */
import { builtinProviders } from '../src/main/core/search/builtin'

const keyword = process.argv[2] ?? '周杰伦'

console.log(`\n搜索关键词: ${keyword}\n${'='.repeat(76)}`)

let totalSongs = 0
let okPlatforms = 0

for (const provider of builtinProviders) {
  const started = Date.now()
  try {
    const res = await provider.search(keyword, 1, 5)
    const cost = Date.now() - started
    if (res.songs.length > 0) okPlatforms += 1
    totalSongs += res.songs.length

    console.log(
      `\n[${provider.platform.padEnd(2)}] ${provider.name}  →  ${res.songs.length} 条 / ${cost}ms`
    )

    for (const s of res.songs.slice(0, 3)) {
      console.log(`     ${s.name}  ——  ${s.singer}`)
      console.log(
        `        album=${s.albumName || '(空)'} | mid=${s.songmid} | ${s.duration}s | hash=${s.hash ?? '-'}`
      )
      console.log(`        pic=${s.picUrl ?? '(无)'}`)
    }
    if (res.songs.length === 0) {
      console.log('     (无结果)')
    }

    // 封面可达性实测：光有地址没用，还得真能取到图
    const withPic = res.songs.filter((s) => s.picUrl)
    console.log(`     ── 封面：${withPic.length}/${res.songs.length} 首有地址`)
    if (withPic.length > 0) {
      const sizes: number[] = []
      const types: string[] = []
      for (const song of withPic.slice(0, 3)) {
        try {
          const response = await fetch(song.picUrl as string, {
            signal: AbortSignal.timeout(8000)
          })
          const bytes = Buffer.from(await response.arrayBuffer())
          sizes.push(bytes.length)
          types.push(response.headers.get('content-type') ?? '?')
        } catch {
          sizes.push(-1)
        }
      }
      console.log(`        实测字节数: ${sizes.map((v) => (v < 0 ? '失败' : v)).join(', ')}`)
      console.log(`        内容类型: ${types.join(', ')}`)
      // 多首封面字节数完全相同 = 大概率是同一张占位图，而不是各自专辑的真实封面
      if (sizes.length > 1 && sizes[0] > 0 && sizes.every((v) => v === sizes[0])) {
        console.log('        ⚠ 多首封面大小完全相同 —— 疑似通用占位图')
      }
    }
  } catch (err) {
    console.log(`\n[${provider.platform.padEnd(2)}] ${provider.name}  →  失败`)
    console.log(`     ${err instanceof Error ? err.message : String(err)}`)
  }
}

console.log(`\n${'='.repeat(76)}`)
console.log(`汇总: ${okPlatforms}/${builtinProviders.length} 个平台可用，共 ${totalSongs} 条结果`)
