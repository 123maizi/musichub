/** 用正确的 API 名字再试一次 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

try {
  const r = await window.api.search.search({ keyword: '周杰伦', platforms: ['kw'] })
  out['仅酷我'] = Array.isArray(r?.platforms)
    ? r.platforms.map((p) => ({ 平台: p.platform, 名称: p.providerName, 条数: p.songs?.length ?? 0, 错误: (p.error ?? '').slice(0, 200) || null }))
    : JSON.stringify(r).slice(0, 400)
  out['仅酷我_合并条数'] = Array.isArray(r?.songs) ? r.songs.length : null
} catch (e) {
  out['仅酷我'] = `抛错: ${String(e.message).slice(0, 300)}`
}

await sleep(400)

try {
  const r = await window.api.search.search({ keyword: '林俊杰' })
  out['全平台'] = Array.isArray(r?.platforms)
    ? r.platforms.map((p) => ({ 平台: p.platform, 名称: p.providerName, 条数: p.songs?.length ?? 0, 错误: (p.error ?? '').slice(0, 160) || null }))
    : JSON.stringify(r).slice(0, 400)
  out['全平台_合并条数'] = Array.isArray(r?.songs) ? r.songs.length : null
} catch (e) {
  out['全平台'] = `抛错: ${String(e.message).slice(0, 300)}`
}

return JSON.stringify(out, null, 1)
