/** 检查纯净度排序有没有误伤正常歌曲 */
const out = {}

for (const kw of ['周杰伦', 'Alan Walker', 'Faded']) {
  const r = await window.api.search.search({ keyword: kw, limit: 30 })
  const kg = r.platforms.find((p) => p.platform === 'kg') ?? r.platforms[0]
  out[kw] = {
    平台: kg?.platform,
    前8条: (kg?.songs ?? []).slice(0, 8).map((s, i) => `${i + 1}. ${s.name} — ${s.singer}`)
  }
}

return JSON.stringify(out, null, 1)
