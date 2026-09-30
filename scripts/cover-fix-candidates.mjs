/**
 * 逐候选诊断：对每首补图失败的歌，把 QQ / 酷狗 的候选**全列出来**，
 * 标出每个候选的分数、以及它到底有没有可用的封面字段（QQ: album.mid；酷狗: trans_param.union_cover）。
 *
 * 目的：把「补不到图」拆成可量化的三类原因 ——
 *   A 关键词带括号后缀导致搜不到（清词重试可救）
 *   B 搜到了但最佳候选没有封面字段（换下一个候选可救）
 *   C 两边确实都没有数据（只能显示占位图标）
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '')
const clean = (v) =>
  String(v ?? '')
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

function rank(list, song, getName, getSinger, getCover) {
  const wantName = norm(song.name)
  const wantSinger = norm(song.singer.split(/[/、,，&]/)[0] ?? '')
  const out = []
  for (const item of list) {
    const name = norm(getName(item))
    if (!name) continue
    const singer = norm(getSinger(item))
    let score = 0
    if (name === wantName) score += 2
    else if (name.includes(wantName) || wantName.includes(name)) score += 1
    if (wantSinger && singer) {
      if (singer.includes(wantSinger) || wantSinger.includes(singer)) score += 2
    }
    out.push({
      score,
      name: getName(item),
      singer: getSinger(item),
      cover: getCover(item)
    })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

function qqCover(item) {
  const mid = item?.album?.mid || item?.albummid || ''
  return mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg` : null
}
function kgCover(item) {
  const raw = item?.trans_param
  if (!raw) return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const c = parsed?.union_cover
    return typeof c === 'string' && c ? c.replace('{size}', '300') : null
  } catch {
    return null
  }
}

async function qq(keyword, song) {
  const url = `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=1&n=5&w=${encodeURIComponent(keyword)}&format=json&cr=1`
  const r = await fetch(url, { headers: { Referer: 'https://y.qq.com/', 'User-Agent': UA } })
  const j = await r.json()
  const list = j?.data?.song?.list ?? []
  return rank(
    list,
    song,
    (i) => i.title || i.songname,
    (i) => (i.singer ?? []).map((x) => x.name).join('/'),
    qqCover
  )
}

async function kg(keyword, song) {
  const url = `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(keyword)}&page=1&pagesize=5&showtype=1`
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  const j = await r.json()
  const list = j?.data?.info ?? []
  return rank(list, song, (i) => i.songname, (i) => i.singername, kgCover)
}

const CASES = [
  { name: '稻香 (完整版|DJ Ray版)', singer: '周杰伦' },
  { name: '夜曲 (升调版伴奏)', singer: '周杰伦' },
  { name: '烟花易冷 (片段)', singer: '周杰伦' },
  { name: '淘汰 (2007上海演唱会)', singer: '周杰伦' },
  { name: '兰亭序+微微辣 (DJ版)', singer: '周杰伦' }
]

const report = []
for (const c of CASES) {
  const full = `${c.name} ${c.singer}`.trim()
  const trimmed = `${clean(c.name)} ${c.singer}`.trim()
  const entry = { 歌名: c.name, 结论: '' }
  const variants = trimmed === full ? [['原词', full]] : [['原词', full], ['清词', trimmed]]

  let bestUsable = null
  for (const [label, kw] of variants) {
    for (const [srcName, fn] of [['QQ', qq], ['KG', kg]]) {
      const list = await fn(kw, c)
      const usable = list.find((x) => x.score >= 3 && x.cover)
      const top = list[0]
      entry[`${srcName}_${label}`] = {
        最高分: top ? `${top.score} ${top.name} - ${top.singer}` : '（无结果）',
        '最高分有封面': !!top?.cover,
        '≥3分且有封面': usable ? `${usable.score} ${usable.name} - ${usable.singer}` : null,
        候选: list.slice(0, 4).map((x) => `${x.score}${x.cover ? '✔' : '✘'} ${x.name}`)
      }
      if (usable && !bestUsable) bestUsable = `${srcName}/${label}: ${usable.name}`
    }
  }
  entry.结论 = bestUsable ? `可补：${bestUsable}` : 'C 类：两边都无可用封面'
  report.push(entry)
}

console.log(JSON.stringify(report, null, 1))
