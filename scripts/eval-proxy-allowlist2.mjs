/**
 * 用「确实存在」的文件验证本地流代理白名单：
 * 把下载目录改到别处之后，老目录里的歌还能不能取到流。
 */
const SANDBOX = 'F:\\MusicHub\\.tmp\\dl-real'
const USER_DIR = 'C:\\Users\\18509\\Desktop\\歌曲下载'
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
  out[label] = {
    下载目录: cfg.dir,
    文件: file.split('\\').pop(),
    取到地址: Boolean(url),
    实际请求: fetched,
    取流错误: err
  }
}

const deskFile = `${USER_DIR}\\Mama's Boy - Ratter.mp3`
const sandboxFile = `${SANDBOX}\\周杰伦 - 晴天.mp3`

await window.api.download.setConfig({ dir: USER_DIR })
await sleep(700)
await probe('A_目录=桌面_取桌面文件', deskFile)
await probe('A2_目录=桌面_取沙盒文件', sandboxFile)

await window.api.download.setConfig({ dir: SANDBOX })
await sleep(700)
await probe('B_目录=沙盒_取桌面文件', deskFile)
await probe('B2_目录=沙盒_取沙盒文件', sandboxFile)

await window.api.download.setConfig({ dir: USER_DIR })
await sleep(700)
await probe('C_目录还原桌面_再取桌面文件', deskFile)

return JSON.stringify(out, null, 1)
