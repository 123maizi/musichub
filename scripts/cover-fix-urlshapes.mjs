/**
 * 打印各平台 picUrl 的真实形态（决定大图替换正则要覆盖哪些写法）。
 * 同时对失败的歌做「原始关键词 vs 去掉括号后缀关键词」的跨平台搜索对比。
 */
const res = await window.api.search.search({ keyword: '周杰伦', page: 1, limit: 30 })
const seen = {}
for (const g of res.platforms) {
  for (const s of g.songs) {
    if (!seen[g.platform]) seen[g.platform] = []
    if (s.picUrl && seen[g.platform].length < 3) seen[g.platform].push(String(s.picUrl))
  }
}
const shapes = {}
const raw = {}
for (const [p, urls] of Object.entries(seen)) {
  shapes[p] = urls.map((u) => u.replace(/\d{2,4}(?=[x/])/g, 'SIZE'))
  raw[p] = urls
}
return JSON.stringify({ 形态: shapes, 原样: raw }, null, 1)
