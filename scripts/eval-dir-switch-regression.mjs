/**
 * 回归验证：换了下载目录之后，老目录里已下好的歌还能不能播。
 *
 * 修复前：代理白名单只有 [当前下载目录, 默认目录]，老目录一律 403。
 * 修复后：白名单动态包含「下载记录里出现过的每个目录」。
 */
const DIR_A = 'F:\\MusicHub\\.tmp\\dl-a'
const DIR_B = 'C:\\Users\\18509\\Desktop\\歌曲下载'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

function localSongFor(file) {
  return {
    id: `local_${file}`,
    platform: 'local',
    songmid: file,
    localPath: file,
    name: file.split('\\').pop(),
    singer: 'test',
    albumName: '',
    duration: 200,
    qualities: ['320k']
  }
}

async function probe(label, file) {
  const cfg = await window.api.download.getConfig()
  let url = null
  let err = null
  try {
    const r = await window.api.player.getUrl({ song: localSongFor(file), quality: '320k' })
    url = r?.url ?? null
  } catch (e) {
    err = String(e?.message ?? e).slice(0, 90)
  }
  let fetched = '未取到地址'
  if (url) {
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-1023' } })
      let bytes = 0
      try {
        bytes = (await res.arrayBuffer()).byteLength
      } catch {
        /* ignore */
      }
      fetched = `HTTP ${res.status}, ${bytes} 字节`
    } catch (e) {
      fetched = `fetch 异常: ${String(e).slice(0, 60)}`
    }
  }
  out[label] = { 下载目录: cfg.dir, 文件: file, 实际请求: fetched, 取流错误: err }
}

/* 1. 下到目录 A */
await window.api.download.setConfig({ dir: DIR_A })
const old = await window.api.download.list()
if (old.length) await window.api.download.remove(old.map((t) => t.id), false)

window.location.hash = '#/search'
await sleep(1800)
const input = document.querySelector('.search-box input')
input.focus()
input.value = ''
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(150)
input.value = '周杰伦 稻香'
input.dispatchEvent(new Event('input', { bubbles: true }))
input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
let rows = []
for (let i = 0; i < 25; i += 1) {
  await sleep(1000)
  rows = [...document.querySelectorAll('.results .row')]
  if (rows.length) break
}
rows[0].querySelector('.col-actions button[title="下载"]')?.click()
let task = null
for (let i = 0; i < 20; i += 1) {
  await sleep(700)
  const all = await window.api.download.list()
  if (all.length) {
    task = all[0]
    break
  }
}
if (!task) return JSON.stringify({ 错误: '没入队' })
for (let i = 0; i < 150; i += 1) {
  await sleep(1000)
  task = (await window.api.download.list()).find((t) => t.id === task.id)
  if (task && ['done', 'error'].includes(task.status)) break
}
out['1_下载到A'] = { 文件: task.fileName, 状态: task.status, 路径: task.savePath }
if (task.status !== 'done') return JSON.stringify(out, null, 1)

await probe('2_目录=A_取A的文件', task.savePath)

/* 2. 把下载目录切到 B（用户的桌面目录） */
await window.api.download.setConfig({ dir: DIR_B })
await sleep(800)
out['3_新下载目录'] = (await window.api.download.getConfig()).dir

/* 3. 关键一步：目录已经换成 B，还能不能播 A 里的文件 */
await probe('4_目录=B_取A的文件（关键）', task.savePath)

/* 4. B 里用户自己的文件当然也要能播 */
await probe('5_目录=B_取B的文件', `${DIR_B}\\Mama's Boy - Ratter.mp3`)

return JSON.stringify(out, null, 1)
