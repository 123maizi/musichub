/**
 * 对「邓紫棋」搜索里 9 行没封面的 kw 歌，用**与主进程完全相同的规则**离线复算一遍，
 * 判断每一首到底是哪一类：
 *   C 类：两个来源、两个关键词轮次都没有可用封面 → 只能占位（正确行为）
 *   A/B 类：其实搜得到 → 说明应用侧还有漏（要修）
 *
 * 规则与 src/main/core/cover/index.ts 保持一致：
 *   · QQ  n=5，酷狗 pagesize=5
 *   · 第 1 轮用完整歌名、门槛 3 分；第 2 轮去掉括号后缀、门槛 4 分
 *   · 分数够的候选逐个试，同分优先真专辑封面（排除酷狗歌手头像）
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '')
const strip = (v) => String(v ?? '').replace(/[（(【[][^）)】\]]*[）)】\]]/g, '').replace(/\s+/g, ' ').trim()
const primary = (v) => String(v ?? '').split(/[/、,，&]/)[0]?.trim() ?? ''

function rank(list, wantName, wantSinger, getName, getSinger, getCover) {
  const n0 = norm(wantName)
  const s0 = norm(wantSinger)
  return list
    .map((item) => {
      const name = norm(getName(item))
      const singer = norm(getSinger(item))
      let score = 0
      if (!name) return null
      if (name === n0) score += 2
      else if (name.includes(n0) || n0.includes(name)) score += 1
      if (s0 && singer && (singer.includes(s0) || s0.includes(singer))) score += 2
      return { score, cover: getCover(item), name: getName(item), singer: getSinger(item) }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
}

function pick(cands, minScore) {
  const usable = cands.filter((c) => c.score >= minScore && c.cover)
  if (!usable.length) return null
  const real = usable.find((c) => !c.cover.includes('singerimg.kugou.com/uploadpic/softhead/'))
  return real ?? usable[0]
}

async function qq(kw) {
  const url = `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?p=1&n=5&w=${encodeURIComponent(kw)}&format=json&cr=1`
  const r = await fetch(url, { headers: { Referer: 'https://y.qq.com/', 'User-Agent': UA } })
  const j = await r.json()
  return j?.data?.song?.list ?? []
}
async function kg(kw) {
  const url = `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(kw)}&page=1&pagesize=5&showtype=1`
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  const j = await r.json()
  return j?.data?.info ?? []
}

const SONGS = [
  { name: '蝶恋花 缘错 歌菲 饭制版', singer: '邓紫棋' },
  { name: 'G.E.M.邓紫棋 (夜空中最亮的星 百色DJ俊良)', singer: '邓紫棋' },
  { name: '叙世 (Live)', singer: '邓紫棋' },
  { name: '月半小夜曲 (Live)', singer: '邓紫棋' },
  { name: '飘向北方 (Live片段)', singer: '邓紫棋' },
  { name: '出现又离开 (片段)', singer: '邓紫棋' },
  { name: '怎么办 (片段)', singer: '邓紫棋' },
  { name: '恭喜发财 (改编版片段)', singer: '邓紫棋' },
  { name: '煎熬 (片段)', singer: '邓紫棋' }
]

const KW_PICK = (i) => {
  const mid = i?.album?.mid || i?.albummid || ''
  return mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg` : null
}
const KG_PICK = (i) => {
  const raw = i?.trans_param
  if (!raw) return null
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw
    return p?.union_cover ? p.union_cover.replace('{size}', '300') : null
  } catch {
    return null
  }
}

const rows = []
for (const s of SONGS) {
  const singer = primary(s.singer)
  const full = s.name.trim()
  const base = strip(full)
  const rounds = [{ kw: `${full} ${singer}`.trim(), name: full, min: 3 }]
  if (base && norm(base) !== norm(full)) rounds.push({ kw: `${base} ${singer}`.trim(), name: base, min: 4 })

  const trace = []
  let found = null
  for (const r of rounds) {
    for (const [srcName, fn, getName, getSinger, getCover] of [
      ['QQ', qq, (i) => i.title || i.songname, (i) => (i.singer ?? []).map((x) => x.name).join('/'), KW_PICK],
      ['KG', kg, (i) => i.songname, (i) => i.singername, KG_PICK]
    ]) {
      const list = await fn(r.kw)
      const cands = rank(list, r.name, singer, getName, getSinger, getCover)
      const got = pick(cands, r.min)
      trace.push({
        轮次: `${srcName}/${r.name}`,
        最高候选: cands[0] ? `${cands[0].score}分 ${cands[0].name} - ${cands[0].singer}` : '(无)',
        命中: got ? `${got.score}分 ${got.name} - ${got.singer}` : null,
        候选: cands.slice(0, 4).map((c) => `${c.score}${c.cover ? '✔' : '✘'}${c.name}`)
      })
      if (got && !found) found = trace[trace.length - 1]
    }
  }
  rows.push({
    歌名: s.name,
    结论: found ? `可补：${found.轮次} → ${found.命中}` : 'C 类：无可用封面（占位正确）',
    明细: trace
  })
}

console.log(JSON.stringify(rows, null, 1))
