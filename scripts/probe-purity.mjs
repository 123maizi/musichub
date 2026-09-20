/**
 * 验证「纯净歌曲优先」排序。
 * 搜一个改版泛滥的词，看干净标题是否浮到前面。
 */
const kw = '晴天'
const r = await window.api.search.search({ keyword: kw, limit: 40 })

const out = []
for (const group of r.platforms) {
  out.push({
    平台: group.platform,
    前12条: group.songs.slice(0, 12).map((s, i) => `${i + 1}. ${s.name} — ${s.singer}`)
  })
}

return JSON.stringify(out, null, 1)
