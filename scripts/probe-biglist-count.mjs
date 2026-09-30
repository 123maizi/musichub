/** 用更大的 limit 拉一批固定行数的结果，供 UI 改版前后做行数稳定的对比 */
const res = await window.api.search.search({ keyword: '周杰伦', limit: 200 })
const counts = (res.platforms ?? []).map((p) => `${p.platform}:${p.songs?.length ?? 0}`)
const total = (res.platforms ?? []).reduce((s, p) => s + (p.songs?.length ?? 0), 0)
return { counts, total, cost: res.cost }
