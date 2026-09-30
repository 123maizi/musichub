/** 直接调应用的搜索 IPC，只要酷我，把真实返回和报错抓出来 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const out = {}

// 先看看 IPC 有哪些搜索入口
out['搜索API'] = Object.keys(window.api.search ?? {})

// 只搜酷我一个平台
try {
  const r = await window.api.search.songs({ keyword: '周杰伦', platforms: ['kw'] })
  out['仅酷我搜索'] = {
    返回类型: Array.isArray(r) ? 'array' : typeof r,
    结果数: Array.isArray(r?.songs) ? r.songs.length : (Array.isArray(r) ? r.length : null),
    平台结果: Array.isArray(r?.platforms)
      ? r.platforms.map((p) => ({ 平台: p.platform, 名称: p.providerName, 条数: p.songs?.length ?? 0, 错误: p.error ?? null }))
      : null,
    原始片段: JSON.stringify(r).slice(0, 300)
  }
} catch (e) {
  out['仅酷我搜索'] = `抛错: ${String(e.message).slice(0, 200)}`
}

await sleep(500)

// 再搜全部平台，看看酷我在整体里是什么状态
try {
  const r = await window.api.search.songs({ keyword: '林俊杰' })
  out['全平台搜索'] = Array.isArray(r?.platforms)
    ? r.platforms.map((p) => ({ 平台: p.platform, 名称: p.providerName, 条数: p.songs?.length ?? 0, 错误: (p.error ?? '').slice(0, 120) || null }))
    : JSON.stringify(r).slice(0, 300)
} catch (e) {
  out['全平台搜索'] = `抛错: ${String(e.message).slice(0, 200)}`
}

return JSON.stringify(out, null, 1)
