/**
 * 播放验证：把 3 个同名并存的文件逐个点「播放」，确认真的能出声。
 * 必须在沙盒目录仍然生效时跑，否则本地流代理会按白名单拒绝读取。
 */
const TEST_DIR = 'F:\\MusicHub\\.tmp\\dl-concurrency'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

await window.api.download.setConfig({ dir: TEST_DIR })
await sleep(500)

window.location.hash = '#/downloads'
await sleep(2500)

let tasks = await window.api.download.list()
tasks = tasks.filter((t) => t.status === 'done')
out['任务数'] = tasks.length
out['文件名'] = tasks.map((t) => t.fileName)

const audit = await window.api.download.audit()
out['存在且体积'] = tasks.map((t) => `${t.fileName}=${audit?.[t.id]?.exists}/${audit?.[t.id]?.size}`)

const rows = [...document.querySelectorAll('.task')]
out['界面行数'] = rows.length

const played = []
for (let i = 0; i < tasks.length; i += 1) {
  const t = tasks[i]
  const rows2 = [...document.querySelectorAll('.task')]
  const row = rows2[i]
  if (!row) {
    played.push({ 序号: i, 文件: t.fileName, 结果: '找不到界面行' })
    continue
  }
  const btn = [...row.querySelectorAll('button')].find((b) =>
    ['播放', '播放中'].includes(b.innerText.trim())
  )
  if (!btn) {
    played.push({
      序号: i,
      文件: t.fileName,
      结果: '没有播放按钮',
      行内按钮: [...row.querySelectorAll('button')].map((b) => b.innerText.trim())
    })
    continue
  }
  btn.click()
  await sleep(4500)
  const el = document.querySelector('audio')
  played.push({
    序号: i,
    文件: t.fileName,
    曲名: document.querySelector('.now-title')?.innerText?.trim() ?? '',
    时间: document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? '',
    音源: document.querySelector('.src-name')?.innerText?.trim() ?? '',
    readyState: el?.readyState ?? null,
    时长秒: el?.duration ? Math.round(el.duration) : null,
    当前秒: el?.currentTime ? Number(el.currentTime.toFixed(1)) : null,
    出错: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 70) ?? ''
  })
  await sleep(500)
}
out['逐个播放'] = played

/* <audio> 是 new Audio() 建的，不在 DOM 里，所以用播放条上的读秒作判据 */
out['全部能播'] = played.every(
  (p) =>
    !p.出错 &&
    p.音源 === '本地文件' &&
    /^00:0[1-9]/.test(p.时间) &&
    /03:4[0-9]/.test(p.时间)
)

return JSON.stringify(out, null, 1)
