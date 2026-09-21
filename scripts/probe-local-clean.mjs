/**
 * 用干净歌词测本地模型走应用链路。
 *
 * 上一轮失败很可能是测试数据自己的锅：为了让缓存不复用，
 * 我在每行歌词尾部加了随机字符串（nmuath2m8 这种东西），
 * 而模型看到这种"乱码尾巴"会发懵 —— 实测它会原样回抄、甚至漏出 </think>。
 * 真实歌词不会长这样，所以换个思路：歌词保持干净，改用不同的曲目来避开缓存。
 */
const VERSE = 'C'

const VERSES = {
  A: [
    "Imagine there's no heaven",
    "It's easy if you try",
    'No hell below us',
    'Above us only sky'
  ],
  B: [
    'Yesterday, all my troubles seemed so far away',
    'Now it looks as though they are here to stay',
    'Oh, I believe in yesterday'
  ],
  C: [
    'Hello darkness, my old friend',
    "I've come to talk with you again",
    'Because a vision softly creeping',
    'Left its seeds while I was sleeping'
  ]
}

const lines = VERSES[VERSE] ?? VERSES.A
const LRC = lines.map((text, i) => `[00:${String(i * 6).padStart(2, '0')}.00]${text}`).join('\n')

const song = {
  id: `clean_${VERSE}_${Date.now().toString(36)}`,
  platform: 'kw',
  songmid: 'clean',
  name: VERSE === 'A' ? 'Imagine' : VERSE === 'B' ? 'Yesterday' : 'The Sound of Silence',
  singer: VERSE === 'A' ? 'John Lennon' : VERSE === 'B' ? 'The Beatles' : 'Simon & Garfunkel',
  albumName: 'test',
  duration: 200,
  qualities: ['320k']
}

const started = Date.now()
const r = await window.api.player.translateLyric({ lyric: LRC, sourceId: 'clean' }, 'zh-CN', song)
const cost = Date.now() - started

const saved = r.translated ? await window.api.ai.getSaved(song.id) : null

return JSON.stringify(
  {
    歌词组: VERSE,
    原文: lines,
    translated: r.translated,
    provider: r.provider,
    providerName: r.providerName,
    耗时ms: cost,
    行数: `${r.lineCount}/${r.totalCount}`,
    译文全文: r.lyric?.tlyric ?? null,
    已保存: Boolean(saved),
    error: r.error
  },
  null,
  1
)
