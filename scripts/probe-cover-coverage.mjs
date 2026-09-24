/**
 * 量化各平台的封面覆盖率。
 * 直接走应用自己的搜索链路，测的就是真实效果。
 */
const KEYWORDS = ['周杰伦', '晴天', 'The Sound of Silence', '邓紫棋', 'Alan Walker']

const out = []

for (const kw of KEYWORDS) {
  const res = await window.api.search.search({ keyword: kw, limit: 20 })
  for (const group of res.platforms) {
    const total = group.songs.length
    const withPic = group.songs.filter((s) => s.picUrl && String(s.picUrl).trim()).length
    out.push({
      关键词: kw,
      平台: `${group.platform} ${group.providerName ?? ''}`,
      有封面: `${withPic}/${total}`,
      覆盖率: total > 0 ? `${Math.round((withPic / total) * 100)}%` : '—',
      缺失示例: group.songs
        .filter((s) => !s.picUrl)
        .slice(0, 2)
        .map((s) => s.name)
    })
  }
}

/* 汇总各平台 */
const byPlatform = new Map()
for (const row of out) {
  const key = row.平台.split(' ')[0]
  const [have, all] = row.有封面.split('/').map(Number)
  const acc = byPlatform.get(key) ?? { have: 0, all: 0 }
  acc.have += have
  acc.all += all
  byPlatform.set(key, acc)
}

const summary = [...byPlatform.entries()].map(([platform, acc]) => ({
  平台: platform,
  合计: `${acc.have}/${acc.all}`,
  覆盖率: `${Math.round((acc.have / Math.max(1, acc.all)) * 100)}%`
}))

return JSON.stringify({ 汇总: summary, 明细: out.filter((r) => !r.有封面.startsWith(r.有封面.split('/')[1])) }, null, 1)
