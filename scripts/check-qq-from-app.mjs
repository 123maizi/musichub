/** 让应用自己去搜 QQ，对比直连的结果 —— 判断是「接口对我不友好」还是「真的坏了」 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

for (const kw of ['周杰伦', '晴天 周杰伦', '告白气球']) {
  const t0 = Date.now()
  try {
    const r = await window.api.search.search({ keyword: kw, platforms: ['tx'], limit: 5 })
    const p = (r.platforms ?? [])[0]
    out['关键词: ' + kw] = {
      耗时: Date.now() - t0,
      条数: p?.songs?.length ?? 0,
      错误: (p?.error ?? '').slice(0, 100) || null,
      首条: p?.songs?.[0] ? p.songs[0].name + ' - ' + p.songs[0].singer : null,
      首条songmid: p?.songs?.[0]?.songmid ?? null
    }
  } catch (e) {
    out['关键词: ' + kw] = '抛错: ' + String(e.message).slice(0, 120)
  }
  await sleep(400)
}

return JSON.stringify(out, null, 1)
