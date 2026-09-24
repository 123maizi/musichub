/**
 * 验证：把「下载目录」改成别处之后，原来目录里已下载的歌还能不能播？
 *
 * 本地流代理只放行白名单目录，而白名单 = [当前下载目录, 默认目录]。
 * 于是「换过下载目录」就等于把老目录里下好的歌全部变成不能播。
 */
const SANDBOX = 'F:\\MusicHub\\.tmp\\dl-real'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

const before = await window.api.download.getConfig()
out['1_当前下载目录'] = before.dir

const tasks = await window.api.download.list()
out['2_任务列表'] = tasks.map((t) => ({ 文件: t.fileName, 状态: t.status, 路径目录: t.savePath.slice(0, t.savePath.lastIndexOf('\\')) }))

/* --- A：目录保持原样，先播一次作为对照 --- */
window.location.hash = '#/downloads'
await sleep(2400)
async function playFirst() {
  const row = [...document.querySelectorAll('.task')][0]
  if (!row) return { 结果: '没有行' }
  const btn = [...row.querySelectorAll('button')].find((b) =>
    ['播放', '播放中', '重新下载'].includes(b.innerText.trim())
  )
  if (!btn) return { 结果: '没有播放按钮' }
  if (btn.innerText.trim() === '重新下载') return { 结果: '标记为文件已丢失' }
  btn.click()
  await sleep(4500)
  return {
    时间: document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? '',
    音源: document.querySelector('.src-name')?.innerText?.trim() ?? '',
    出错: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 120) ?? ''
  }
}
out['3_目录未变时播放'] = await playFirst()

/* --- B：把下载目录改到别处，再播同一个文件 --- */
await window.api.download.setConfig({ dir: SANDBOX })
await sleep(800)
out['4_改后下载目录'] = (await window.api.download.getConfig()).dir

window.location.hash = '#/search'
await sleep(1200)
window.location.hash = '#/downloads'
await sleep(2400)
out['5_换目录后播放同一文件'] = await playFirst()

/* --- C：直接问代理要这个文件 --- */
const target = tasks.find((t) => t.status === 'done')
if (target) {
  const b64 = btoa(unescape(encodeURIComponent(target.savePath)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  try {
    const r = await fetch(`http://127.0.0.1:${location.port || 0}/local?p=${b64}`).catch(() => null)
    out['6_直接请求代理'] = r ? `HTTP ${r.status}` : '请求失败'
  } catch (e) {
    out['6_直接请求代理'] = String(e).slice(0, 80)
  }
}

/* --- D：还原 --- */
await window.api.download.setConfig({ dir: before.dir })
await sleep(600)
window.location.hash = '#/search'
await sleep(1000)
window.location.hash = '#/downloads'
await sleep(2400)
out['7_还原目录后再播'] = await playFirst()
out['8_已还原目录'] = (await window.api.download.getConfig()).dir

return JSON.stringify(out, null, 1)
