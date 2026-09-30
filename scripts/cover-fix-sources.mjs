/**
 * 独立于应用的诊断：直接打 QQ / 酷狗的搜索接口，
 * 看那几首补图失败的歌，用「原始关键词」与「去掉括号后缀的关键词」分别能搜到什么。
 * 目的是量化「清词重试」能救回几条，而不是凭感觉改阈值。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '')
/** 去掉括号后缀：稻香 (完整版|DJ Ray版) -> 稻香 */
const clean = (v) => String(v ?? '').replace(/[（(【\[].*?[）)】\]]/g, '').replace(/\s+/g, ' ').trim()

function score(list, song, getName, getSinger) {
  const wantName = norm(song.name)
  const wantSinger = norm(song.singer.split(/[/、,，&]/)[0] ?? '')
  const out = []
  for (const item of list) {
    const name = norm(getName(item))
    const singer = norm(getSinger(item))
    if (!name) continue
    let s = 0
    let why = ''
    if (name === wantName) { s += 2; why += 'name=' }
    else if (name.includes(wantName) || wantName.includes(name)) { s += 1; why += 'name~' }
    if (wantSinger && singer) {
      if (singer.includes(wantSinger) || wantSinger.includes(singer)) { s += 2; why += 'singer=' }
    }
    out.push({ s, why, name: getName(item), singer: getSinger(item) })
  }
  out.sort((a, b) => b.s - a.s)
  return out.slice(0, 3)
}

async function qq(keyword, song) {
  const url = `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=1&n=3&w=${encodeURIComponent(keyword)}&format=json&cr=1`
  try {
    const r = await fetch(url, { headers: { Referer: 'https://y.qq.com/', 'User-Agent': UA } })
    const j = await r.json()
    const list = j?.data?.song?.list ?? []
    return score(list, song, (i) => i.title || i.songname, (i) => (i.singer ?? []).map((x) => x.name).join('/'))
  } catch (e) {
    return [{ s: -1, why: 'ERR ' + e.message.slice(0, 40), name: '', singer: '' }]
  }
}

async function kg(keyword, song) {
  const url = `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(keyword)}&page=1&pagesize=3&showtype=1`
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } })
    const j = await r.json()
    const list = j?.data?.info ?? []
    return score(list, song, (i) => i.songname, (i) => i.singername)
  } catch (e) {
    return [{ s: -1, why: 'ERR ' + e.message.slice(0, 40), name: '', singer: '' }]
  }
}

const CASES = [
  { name: '刀马旦', singer: '周杰伦', note: '基线：有 picUrl 但图挂了' },
  { name: '稻香 (完整版|DJ Ray版)', singer: '周杰伦', note: '基线：无 picUrl' },
  { name: '夜曲 (升调版伴奏)', singer: '周杰伦', note: '基线：无 picUrl' },
  { name: '烟花易冷 (片段)', singer: '周杰伦', note: '基线：无 picUrl' },
  { name: '淘汰 (2007上海演唱会)', singer: '周杰伦', note: '基线：无 picUrl' },
  { name: '兰亭序+微微辣 (DJ版)', singer: '周杰伦', note: '基线：无 picUrl' },
  { name: '蜗牛', singer: '周杰伦', note: '历史事故曲目：必须只能命中周杰伦版本' }
]

const report = []
for (const c of CASES) {
  const row = { 歌名: c.name, 说明: c.note }
  const keywordFull = `${c.name} ${c.singer}`.trim()
  const keywordClean = `${clean(c.name)} ${c.singer}`.trim()
  row.原词 = keywordFull
  row.清词 = keywordClean
  row.QQ_原词 = await qq(keywordFull, c)
  row.QQ_清词 = keywordClean === keywordFull ? '（同原词）' : await qq(keywordClean, c)
  row.KG_原词 = await kg(keywordFull, c)
  row.KG_清词 = keywordClean === keywordFull ? '（同原词）' : await kg(keywordClean, c)
  report.push(row)
}

console.log(JSON.stringify(report, null, 1))
