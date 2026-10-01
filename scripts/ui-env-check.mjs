/**
 * 环境自检（所有探针的统一输出头）
 *
 * 为什么需要它 —— Lead 刚踩到的坑：
 *   重启实例时，新进程可能**撞上单实例锁直接退出**，而旧实例继续在同一个 CDP 端口上服务。
 *   于是你以为在测新构建，其实测的是旧构建，得到的是一堆「修复没生效」的假失败。
 *   本仓库里已经因为这类「看起来一样的失败」误判过好几次（半新半旧产物、懒加载 chunk 404、
 *   单实例锁导致假重启）。
 *
 * 判据很直接：**运行中页面加载的入口 chunk 名，必须出现在产物 index.html 的引用里**。
 * 不一致 → 你连到的是旧实例或旧构建，先别信任何结论。
 *
 * 本探针只报告事实；与磁盘比对由宿主机侧的 runner 完成（渲染层读不到文件系统）。
 */
const out = { steps: {} }

/** 页面实际加载的脚本（入口 + 已经懒加载进来的 chunk） */
const loaded = [...document.querySelectorAll('script[src]')].map((s) => {
  const src = s.getAttribute('src') || ''
  return src.split('/').pop() || src
})

/** 从性能条目里把已经拉取过的 assets 也捞出来（懒加载 chunk 不在 script 标签里） */
let fetched = []
try {
  fetched = performance
    .getEntriesByType('resource')
    .map((e) => String(e.name || '').split('/').pop() || '')
    .filter((n) => /^[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.js$/.test(n))
} catch {
  /* 拿不到就算了 */
}

out.steps.entryScripts = loaded
out.steps.loadedChunks = [...new Set(fetched)].slice(0, 40)
out.steps.hash = location.hash
out.steps.title = document.title
/** 视图是否真的挂上了（route meta 标题会体现在顶栏） */
out.steps.topbarTitle = document.querySelector('.topbar-title')?.textContent?.trim() ?? null
/** 只有存在这个标记才说明「当前页面是真实渲染过的」，而不是白屏 */
out.steps.hasShell = Boolean(document.querySelector('.shell, .rail, main'))
out.steps.readyState = document.readyState

return out
