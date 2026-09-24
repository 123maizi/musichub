/**
 * 直接把「下载目录以外」的本地文件交给取流接口，看本地流代理放不放行。
 *
 * 判据：能取到地址但 fetch 被拒（403）＝白名单只认当前下载目录，
 * 那么「换过下载目录」就会让老目录里下好的歌全部播不了。
 */
const SANDBOX = 'F:\\MusicHub\\.tmp\\dl-real'
const USER_DIR = 'C:\\Users\\18509\\Desktop\\歌曲下载'
const FILE = `${USER_DIR}\\周杰伦 - 晴天.flac`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

const localSong = {
  id: `local_${FILE}`,
  platform: 'local',
  songmid: FILE,
  localPath: FILE,
  name: '晴天',
  singer: '周杰伦',
  albumName: '叶惠美',
  duration: 269,
  qualities: ['flac', '320k']
}

async function probe(label) {
  const cfg = await window.api.download.getConfig()
  let url = null
  let err = null
  try {
    const r = await window.api.player.getUrl({ song: localSong, quality: '320k' })
    url = r?.url ?? null
  } catch (e) {
    err = String(e?.message ?? e).slice(0, 100)
  }
  let fetched = '未取到地址'
  if (url) {
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-1023' } })
      fetched = `HTTP ${res.status}`
      try {
        await res.arrayBuffer()
      } catch {
        /* ignore */
      }
    } catch (e) {
      fetched = `fetch 异常: ${String(e).slice(0, 60)}`
    }
  }
  out[label] = { 下载目录: cfg.dir, 取到地址: Boolean(url), 地址前缀: url ? url.slice(0, 60) : null, 取流错误: err, 实际请求: fetched }
}

/* A：下载目录指向沙盒 —— 用户的桌面目录在白名单之外 */
await window.api.download.setConfig({ dir: SANDBOX })
await sleep(700)
await probe('A_下载目录=沙盒_文件在桌面')

/* B：下载目录就是桌面目录 */
await window.api.download.setConfig({ dir: USER_DIR })
await sleep(700)
await probe('B_下载目录=桌面')

/* C：再切回沙盒，确认可复现 */
await window.api.download.setConfig({ dir: SANDBOX })
await sleep(700)
await probe('C_再切回沙盒')

return JSON.stringify(out, null, 1)
