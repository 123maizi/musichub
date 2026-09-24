/**
 * 安全边界复查：白名单之外、且不属于任何下载记录的目录，必须仍然被拒绝。
 * 否则这次修复就把「本地流代理」变成了任意文件读取接口。
 */
const OUTSIDE = 'F:\\MusicHub\\.tmp\\outside\\secret.mp3'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

async function probe(label, file) {
  const cfg = await window.api.download.getConfig()
  let url = null
  let err = null
  try {
    const r = await window.api.player.getUrl({
      song: {
        id: `local_${file}`,
        platform: 'local',
        songmid: file,
        localPath: file,
        name: 'x',
        singer: 'y',
        albumName: '',
        duration: 100,
        qualities: ['320k']
      },
      quality: '320k'
    })
    url = r?.url ?? null
  } catch (e) {
    err = String(e?.message ?? e).slice(0, 80)
  }
  let fetched = '未取到地址'
  if (url) {
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-255' } })
      let bytes = 0
      try {
        bytes = (await res.arrayBuffer()).byteLength
      } catch {
        /* ignore */
      }
      fetched = `HTTP ${res.status}, ${bytes} 字节`
    } catch (e) {
      fetched = `fetch 异常: ${String(e).slice(0, 50)}`
    }
  }
  out[label] = { 下载目录: cfg.dir, 文件: file, 实际请求: fetched, 取流错误: err }
}

await window.api.download.setConfig({ dir: 'C:\\Users\\18509\\Desktop\\歌曲下载' })
await sleep(700)
await probe('白名单外目录（应被拒绝）', OUTSIDE)

return JSON.stringify(out, null, 1)
