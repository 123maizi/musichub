/**
 * 搜索缓存上限验证探针（task-3 第 10 项：常驻大对象）
 *
 * 背景：SearchEngine 的缓存原本只在「条数 > 60」时清掉**已过期**的项。
 * 用户连续搜不同关键词/翻不同页时，60 条可能全都还没过期 —— 一条都删不掉，
 * 缓存于是无界增长。每条响应装着最多 5 个平台 × 50 首，每首还带平台原始字段。
 *
 * 本探针用「同一个关键词翻 80 页」制造 80 个互不相同的缓存键
 * （缓存键含 page），全部命中真实接口、都有真实载荷。
 * 探针本身不保留任何返回值，所以外部测到的主进程内存增量只可能来自主进程侧。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PAGES = 200
const BATCH = 8
const KEYWORD = '周杰伦'
const out = { keyword: KEYWORD, pages: PAGES, batches: [], songsSeen: 0, errors: [] }

for (let start = 1; start <= PAGES; start += BATCH) {
  const group = []
  for (let p = start; p < start + BATCH && p <= PAGES; p += 1) {
    group.push(
      window.api.search
        .search({ keyword: KEYWORD, page: p, limit: 50, platforms: ['kw'] })
        .then((res) => {
          const n = res.platforms.reduce((a, x) => a + (x.songs?.length ?? 0), 0)
          out.songsSeen += n
          return n
        })
        .catch((err) => {
          out.errors.push(`page ${p}: ${err && err.message}`)
          return 0
        })
    )
  }
  const counts = await Promise.all(group)
  out.batches.push({ from: start, counts })
  await sleep(150) // 给主进程一点喘息，也让每批都形成不同的缓存写入
}

// 再等一会儿，让主进程把该做的收尾做完
await sleep(1500)
out.done = true
return out
