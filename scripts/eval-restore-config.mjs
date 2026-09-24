/* 收尾：恢复下载目录与格式，清掉测试任务 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await window.api.download.setConfig({
  dir: 'C:\\Users\\18509\\Desktop\\歌曲下载',
  preferQuality: 'flac24bit'
})
const all = await window.api.download.list()
if (all.length) await window.api.download.remove(all.map((t) => t.id), false)
await sleep(600)

const cfg = await window.api.download.getConfig()
return JSON.stringify({
  目录: cfg.dir,
  格式: cfg.preferQuality,
  任务数: (await window.api.download.list()).length
})
