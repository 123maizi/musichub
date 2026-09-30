/** 把基线里补图失败的 5 首歌的完整字段打出来（怀疑 singer / 名字形态影响了打分） */
const NAMES = [
  '稻香 (完整版|DJ Ray版)',
  '夜曲 (升调版伴奏)',
  '烟花易冷 (片段)',
  '淘汰 (2007上海演唱会)',
  '兰亭序+微微辣 (DJ版)'
]
const res = await window.api.search.search({ keyword: '周杰伦', page: 1, limit: 30 })
const all = res.platforms.flatMap((g) => g.songs)
return JSON.stringify(
  NAMES.map((n) => {
    const s = all.find((x) => x.name === n)
    if (!s) return { 找不到: n }
    return {
      name: s.name,
      singer: s.singer,
      'singer的类型': typeof s.singer,
      platform: s.platform,
      id: s.id,
      albumName: s.albumName,
      picUrl: s.picUrl ?? '(undefined)'
    }
  }),
  null,
  1
)
