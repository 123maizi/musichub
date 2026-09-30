/**
 * 搜索缓存上限验证探针（task-3 第 10 项：常驻大对象）
 *
 * 判据怎么选（迭代过两次，记下来免得后人再踩）：
 *   ① 「cost === 0 就是命中」—— 不成立。深层翻页 / 熔断短路时，一次**真实执行**
 *      也只有 0ms，cost 同样是 0，结论会完全反过来。
 *   ② 单看耗时 —— 会被熔断短路污染：平台被冷却后每次都是 1ms，看着像命中。
 *   现在用「耗时 <= 8ms **且** 结果里没有任何平台报错」：
 *      命中缓存：search() 在缓存分支直接 return，没有平台错误；
 *      真实执行：至少一次平台往返，>= 20ms；
 *      熔断短路：1ms，但平台条目上带着 "暂时跳过" 的 error。
 *   三者在数据上互不重叠。
 *
 * 用例构造（刻意绕开单平台突发，免得把平台打到熔断）：
 *   4 个平台 × 每平台 18 页 = 72 个互不相同的缓存键（72 > 硬上限 60）。
 *   逐条轮流打不同平台，单平台最多 18 次请求，不会触发限流；
 *   页 1~18 都是有真实数据的浅页，不存在「空响应」这种模糊情况。
 *
 * 为什么逆序复查：命中不写缓存也不淘汰；未命中会插入并淘汰最旧一条。
 * 逆序访问时先命中的都是较新条目，等走到已被淘汰的那批时，淘汰顺序与
 * 遍历方向一致，不会再挤掉尚未访问的条目 —— 命中数恰好等于实际保留条数。
 *
 * 预期：修复前 = 72（从未淘汰）；修复后 = 60（CACHE_MAX 硬上限）。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PLATFORMS = ['kw', 'kg', 'tx', 'wy']
const PAGES = 18
const HIT_MS = 8

const keys = []
for (let p = 1; p <= PAGES; p += 1) {
  for (const pf of PLATFORMS) keys.push({ platform: pf, page: p, label: pf + '#' + p })
}

const out = { totalKeys: keys.length, platforms: PLATFORMS, pages: PAGES }

async function timed(platform, page) {
  const t0 = performance.now()
  const r = await window.api.search.search({
    keyword: '周杰伦',
    page,
    limit: 30,
    platforms: [platform]
  })
  const ms = Math.round(performance.now() - t0)
  const errors = (r?.platforms ?? []).filter((p) => p.error).map((p) => p.error)
  const songs = (r?.platforms ?? []).reduce((a, p) => a + (p.songs?.length ?? 0), 0)
  return { ms, cost: r?.cost ?? null, errors, songs }
}

/* ---------- 1. 预热：72 个不同的键，全部是真实执行 ---------- */
const prime = []
for (const k of keys) {
  try {
    const t = await timed(k.platform, k.page)
    prime.push({ ...k, ...t })
  } catch (err) {
    prime.push({ ...k, ms: -1, cost: null, errors: [String(err && err.message)], songs: 0 })
  }
  await sleep(90)
}
const realPrime = prime.filter((p) => p.ms > HIT_MS && p.errors.length === 0)
out.prime = {
  calls: prime.length,
  realCleanExecutions: realPrime.length,
  errorsDuringPrime: prime.filter((p) => p.errors.length > 0).length,
  medianMs: [...prime.map((p) => p.ms)].sort((a, b) => a - b)[Math.floor(prime.length / 2)],
  songsTotal: prime.reduce((a, p) => a + p.songs, 0)
}

await sleep(1500)

/* ---------- 2. 逆序复查：只统计预热时「成功且干净」的那些键 ---------- */
const cleanSet = new Set(realPrime.map((p) => p.label))
const ordered = keys.slice().reverse().filter((k) => cleanSet.has(k.label))
const hits = []
const misses = []
const samples = []
for (const k of ordered) {
  let t
  try {
    t = await timed(k.platform, k.page)
  } catch (err) {
    misses.push({ ...k, ms: -1, errors: [String(err && err.message)] })
    continue
  }
  const isHit = t.ms <= HIT_MS && t.errors.length === 0
  if (samples.length < 10) samples.push({ ...k, ...t, isHit })
  if (isHit) hits.push({ ...k, ...t })
  else misses.push({ ...k, ...t })
}

out.requery = {
  consideredKeys: ordered.length,
  hitCount: hits.length,
  missCount: misses.length,
  hitOrderRange: hits.length ? { first: 0, last: hits.length - 1 } : null,
  samples
}
out.verdict =
  ordered.length > 0 && hits.length >= ordered.length
    ? `全部 ${ordered.length} 个键都还在缓存里 → 缓存没有上限`
    : `保留了 ${hits.length} / ${ordered.length} 个键 → 缓存有硬上限（上限约 ${hits.length}）`

return out
