/**
 * 歌词服务验证
 *
 * 直接跑真实的 lyric 模块，用热门歌曲确认两路数据源都能拿到词。
 * 上一轮的教训：功能写完必须端到端验证，不能只看代码逻辑。
 *
 * 运行： npm run verify:lyric
 */
import type { Song } from '@shared/types/music'
import { fetchBuiltinLyric } from '../src/main/core/lyric'

function makeSong(name: string, singer: string): Song {
  return {
    id: `test_${name}`,
    platform: 'kg',
    songmid: 'test',
    name,
    singer,
    albumName: '',
    duration: 269,
    qualities: ['128k']
  } as Song
}

const cases: Song[] = [
  makeSong('晴天', '周杰伦'),
  makeSong('稻香', '周杰伦'),
  makeSong('夜曲', '周杰伦'),
  makeSong('海阔天空', 'Beyond'),
  makeSong('平凡之路', '朴树')
]

console.log(`\n歌词服务验证 · ${cases.length} 首热门歌曲\n${'='.repeat(74)}`)

let ok = 0

for (const song of cases) {
  const started = Date.now()
  try {
    const lyric = await fetchBuiltinLyric(song)
    const cost = Date.now() - started

    if (!lyric) {
      console.log(`\n✗ ${song.name} — ${song.singer}   (${cost}ms)   拿不到歌词`)
      continue
    }

    ok += 1
    const lines = lyric.lyric.split('\n').filter((line) => line.trim()).length
    console.log(`\n✓ ${song.name} — ${song.singer}   (${cost}ms)`)
    console.log(`   来源: ${lyric.sourceId}`)
    console.log(`   ${lines} 行 / ${lyric.lyric.length} 字符`)
    console.log(`   预览: ${lyric.lyric.split('\n').slice(0, 3).join(' | ').slice(0, 92)}`)
  } catch (err) {
    console.log(`\n✗ ${song.name} — 异常: ${err instanceof Error ? err.message : err}`)
  }
}

console.log(`\n${'='.repeat(74)}`)
console.log(`汇总: ${ok}/${cases.length} 首成功拿到歌词`)
console.log(`${'='.repeat(74)}\n`)
