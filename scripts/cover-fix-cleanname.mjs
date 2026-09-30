/**
 * 判别实验：同样的歌，只改歌名（带括号后缀 vs 干净名），看主进程补图结果差别。
 * 如果干净名能返回封面，说明瓶颈在「搜索关键词」；如果干净名也返回 null，
 * 说明这两个来源在这些歌上确实拿不到 —— 两种结论的修法完全不同。
 */
const CASES = [
  { name: '稻香 (完整版|DJ Ray版)', singer: '周杰伦' },
  { name: '稻香', singer: '周杰伦' },
  { name: '夜曲 (升调版伴奏)', singer: '周杰伦' },
  { name: '夜曲', singer: '周杰伦' },
  { name: '烟花易冷 (片段)', singer: '周杰伦' },
  { name: '烟花易冷', singer: '周杰伦' },
  { name: '淘汰 (2007上海演唱会)', singer: '周杰伦' },
  { name: '淘汰', singer: '周杰伦' },
  { name: '兰亭序+微微辣 (DJ版)', singer: '周杰伦' },
  { name: '兰亭序+微微辣', singer: '周杰伦' },
  { name: '晴天', singer: '周杰伦' },
  { name: '一个根本不存在的歌名XYZQW', singer: '周杰伦' }
]

const out = []
for (const c of CASES) {
  const song = {
    id: 'probe_' + Math.random().toString(36).slice(2, 8),
    platform: 'kw',
    songmid: '0',
    name: c.name,
    singer: c.singer,
    albumName: '',
    duration: 200,
    qualities: ['320k']
  }
  const started = performance.now()
  let url = null
  let err = null
  try {
    url = await window.api.player.resolveCover(song)
  } catch (e) {
    err = String(e.message).slice(0, 80)
  }
  out.push({ 歌名: c.name, 结果: url || null, err, 耗时ms: Math.round(performance.now() - started) })
}
return JSON.stringify(out, null, 1)
