/**
 * 文件丢失场景的界面表现：
 *  - 列表要明确标出「文件已丢失」
 *  - 播放按钮要换成「重新下载」，而不是点下去毫无反应
 *  - 点「重新下载」要真的重新入库并把文件拿回来
 */
const TEST_DIR = 'F:\\MusicHub\\.tmp\\dl-concurrency'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

await window.api.download.setConfig({ dir: TEST_DIR })
window.location.hash = '#/downloads'
await sleep(600)
window.location.hash = '#/search'
await sleep(1200)
window.location.hash = '#/downloads'
await sleep(2500)

const rows = [...document.querySelectorAll('.task')]
out['行数'] = rows.length
out['各行状态'] = rows.map((r) => ({
  文本: r.innerText.replace(/\s+/g, ' ').slice(0, 130),
  按钮: [...r.querySelectorAll('button')].map((b) => b.innerText.trim())
}))

const missingRow = rows.find((r) => r.innerText.includes('文件已丢失'))
out['标出丢失的有几行'] = missingRow ? 1 : 0

if (missingRow) {
  const redl = [...missingRow.querySelectorAll('button')].find(
    (b) => b.innerText.trim() === '重新下载'
  )
  out['有重新下载按钮'] = Boolean(redl)
  if (redl) {
    redl.click()
    await sleep(1500)
    let tasks = await window.api.download.list()
    const target = tasks.find((t) => t.status !== 'done')
    out['重新入队的任务'] = target ? target.fileName : '(没找到新任务)'
    for (let i = 0; i < 120; i += 1) {
      await sleep(1000)
      tasks = await window.api.download.list()
      const t = tasks.find((x) => x.id === target?.id)
      if (t && ['done', 'error'].includes(t.status)) break
    }
    const t2 = tasks.find((x) => x.id === target?.id)
    out['重新下载结果'] = t2 ? { 文件: t2.fileName, 状态: t2.status, 错误: t2.error ?? null } : '任务没了'
    const audit = await window.api.download.audit()
    out['文件是否回来了'] = t2 ? (audit?.[t2.id]?.exists ?? null) : null
  }
} else {
  out['提示'] = '界面上没有出现「文件已丢失」标记'
}

return JSON.stringify(out, null, 1)
