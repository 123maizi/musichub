/**
 * 四种任务行状态：第二阶段 —— 让 missing 态真正出现（task-8 专用）
 *
 * 前置：宿主机已经删掉了 ui-probe-build-states.mjs 返回的 deleteThisFile。
 * 这里只做一件事：让 DownloadView 重新挂载 → store.refresh() → store.audit()
 * 把「任务说已完成、磁盘上却没有」标出来，于是行上出现「文件已丢失」与「重新下载」。
 *
 * 顺带把四种状态的行都读一遍 DOM：这是「设计改完没有把状态态做丢」的硬证据。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { steps: {} }

function domStates() {
  return [...document.querySelectorAll('.task')].map((r) => {
    const fill = r.querySelector('.bar > i')
    const cs = fill ? getComputedStyle(fill) : null
    return {
      cls: String(r.className),
      name: (r.querySelector('.name')?.textContent || '').trim().slice(0, 24),
      tags: [...r.querySelectorAll('.tag')].map((t) => (t.textContent || '').trim()),
      pct: (r.querySelector('.num')?.textContent || '').trim(),
      fillStyle: fill ? fill.getAttribute('style') || '' : null,
      fillWidthPx: fill ? Number(fill.getBoundingClientRect().width.toFixed(2)) : null,
      missing: /文件已丢失/.test(r.textContent || ''),
      ops: [...r.querySelectorAll('.ops button')].map((b) => (b.textContent || '').trim())
    }
  })
}

/** 导航走导航柱：`location.hash = ...` 在这个外壳里 hash 变了视图常常不换 */
async function railGo(label, waitMs) {
  const b = [...document.querySelectorAll('.nav-item')].find(
    (x) => (x.getAttribute('aria-label') || '') === label
  )
  if (b) b.click()
  else location.hash = '#/' + label
  await sleep(waitMs)
}

// 先离开下载页再回来，强制 onMounted 重跑（refresh + audit）
await railGo('搜索', 900)
await railGo('下载', 2200)

// 再显式催一次体检，避免首帧还没算完就采样
await window.api.download.audit()
await sleep(600)
await railGo('我的', 800)
await railGo('下载', 2000)

const states = domStates()
out.steps.domStates = states
out.steps.stateCensus = {
  行数: states.length,
  下载中: states.filter((s) => /\bdownloading\b/.test(s.cls)).length,
  已暂停: states.filter((s) => /\bpaused\b/.test(s.cls)).length,
  已完成: states.filter((s) => /\bdone\b/.test(s.cls)).length,
  失败: states.filter((s) => /\berror\b/.test(s.cls)).length,
  文件已丢失标记: states.filter((s) => s.missing).length,
  出现重新下载按钮: states.filter((s) => s.ops.includes('重新下载')).length,
  出现暂停按钮: states.filter((s) => s.ops.includes('暂停')).length,
  出现继续按钮: states.filter((s) => s.ops.includes('继续')).length,
  出现播放按钮: states.filter((s) => s.ops.includes('播放')).length
}
out.steps.missingVisible = out.steps.stateCensus.文件已丢失标记 > 0

/* 进度条迁移判据：所有填充条都不该再有内联 width */
out.steps.fillBindings = states.map((s) => s.fillStyle).filter(Boolean)
out.steps.anyInlineWidth = out.steps.fillBindings.some((v) => /width/i.test(v))
out.steps.allUseCustomProp = out.steps.fillBindings.every((v) => /--p\s*:/.test(v))

return out
