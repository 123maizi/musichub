/**
 * 端到端：走真实下载链路下一首 MP3（带封面、带标签），
 * 然后把产物交给系统解码器验证 —— 这才是唯一能抓住 COMM 帧那种 bug 的判据。
 */
const TEST_DIR = 'F:\\MusicHub\\.tmp\\dl-e2e-mp3'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

await window.api.download.setConfig({ dir: TEST_DIR, preferQuality: '320k' })
const old = await window.api.download.list()
if (old.length) await window.api.download.remove(old.map((t) => t.id), false)

window.location.hash = '#/search'
await sleep(2000)
const input = document.querySelector('.search-box input')
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(150)
input.value = 'Corbon Amodio lucy'
input.dispatchEvent(new Event('input', { bubbles: true }))
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
let rows = []
for (let i = 0; i < 25; i += 1) {
  await sleep(1000)
  rows = [...document.querySelectorAll('.results .row')]
  if (rows.length) break
}
rows[0].querySelector('.col-actions button[title^="下载为"]')?.click()

let t = null
for (let i = 0; i < 30; i += 1) {
  await sleep(700)
  const all = await window.api.download.list()
  if (all.length) {
    t = all[0]
    break
  }
}
if (!t) return JSON.stringify({ 错误: '没入队' })
for (let i = 0; i < 180; i += 1) {
  await sleep(1000)
  t = (await window.api.download.list()).find((x) => x.id === t.id)
  if (t && ['done', 'error'].includes(t.status)) break
}
out['下载结果'] = { 文件: t.fileName, 状态: t.status, 错误: t.error ?? null, 路径: t.savePath }

/* 应用内是否仍能解码（不能为了修 Windows 把浏览器搞坏） */
try {
  const r = await window.api.player.getUrl({
    song: {
      id: 'local_x',
      platform: 'local',
      songmid: t.savePath,
      localPath: t.savePath,
      name: t.song.name,
      singer: t.song.singer,
      albumName: '',
      duration: 0,
      qualities: ['320k']
    },
    quality: '320k'
  })
  const el = new Audio()
  el.preload = 'metadata'
  el.src = r.url
  const dec = await new Promise((resolve) => {
    const done = (how) =>
      resolve({ 结束: how, readyState: el.readyState, 秒: Number.isFinite(el.duration) ? Math.round(el.duration) : null, 错误码: el.error?.code ?? null })
    el.addEventListener('loadedmetadata', () => done('ok'), { once: true })
    el.addEventListener('error', () => done('error'), { once: true })
    setTimeout(() => done('超时'), 8000)
  })
  out['浏览器解码'] = dec
} catch (e) {
  out['浏览器解码'] = String(e.message).slice(0, 80)
}

return JSON.stringify(out, null, 1)

