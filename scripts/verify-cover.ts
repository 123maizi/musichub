/**
 * 封面补全验证
 *
 * 直接跑真实的 cover 模块，用「酷狗 / 酷我那些没有封面的歌」当输入，
 * 确认能否从别处补到真实封面 —— 并且真的下载一次，验证地址可用。
 *
 * 运行： npm run verify:cover
 */
import type { Song } from '@shared/types/music'
import { resolveCover } from '../src/main/core/cover'

/** 构造测试用歌曲：刻意模拟酷狗、酷我这类「平台不给封面」的条目 */
function makeSong(platform: string, name: string, singer: string, albumName = ''): Song {
  return {
    id: `${platform}_test_${name}`,
    platform,
    songmid: 'test',
    name,
    singer,
    albumName,
    duration: 269,
    qualities: ['128k', '320k']
  } as Song
}

const cases: Song[] = [
  makeSong('kg', '晴天', '周杰伦', '叶惠美'),
  makeSong('kg', '稻香', '周杰伦', '魔杰座'),
  makeSong('kw', '夜曲', '周杰伦', '十一月的萧邦'),
  makeSong('kg', '告白气球', '周杰伦', '周杰伦的床边故事'),
  makeSong('kw', '海阔天空', 'Beyond', '乐与怒')
]

console.log(`\n封面补全验证 · ${cases.length} 首「平台不给封面」的歌曲\n${'='.repeat(74)}`)

let ok = 0

for (const song of cases) {
  const started = Date.now()
  try {
    const url = await resolveCover(song)
    const cost = Date.now() - started

    if (!url) {
      console.log(`\n✗ [${song.platform}] ${song.name} —— 补不到封面`)
      continue
    }

    // 光有地址不够，得真能取到图
    let verdict = ''
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      const bytes = Buffer.from(await res.arrayBuffer())
      verdict = `HTTP ${res.status} · ${bytes.length} 字节 · ${res.headers.get('content-type') ?? '?'}`
      if (res.ok && bytes.length > 1000) ok += 1
    } catch (err) {
      verdict = `取图失败: ${err instanceof Error ? err.message : String(err)}`
    }

    console.log(`\n✓ [${song.platform}] ${song.name} — ${song.singer}   (${cost}ms)`)
    console.log(`   ${url.slice(0, 88)}`)
    console.log(`   ${verdict}`)
  } catch (err) {
    console.log(`\n✗ [${song.platform}] ${song.name} —— 异常: ${err instanceof Error ? err.message : err}`)
  }
}

console.log(`\n${'='.repeat(74)}`)
console.log(`汇总: ${ok}/${cases.length} 首成功补到真实封面`)
console.log(`${'='.repeat(74)}\n`)
