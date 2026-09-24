/**
 * 批量真解码：目录里每一个音频文件都过一遍 Chromium，
 * 找出「结构看着没问题、实际解码失败」的那些。
 */
const DIR = 'C:\\Users\\18509\\Desktop\\歌曲下载'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const names = [
  '20 Min - Lil Uzi Vert.flac',
  'Corbon Amodio - lucy~.mp3',
  "Hasta Que Llegue la Muerte - Depresión Sonora.mp3",
  'Lil Wayne、Bobby V.、Kidd Kidd - Mrs. Officer (Explicit).m4a',
  "Mama's Boy - Ratter.mp3",
  'Meant To Be - Cuntsniffer.mp3',
  'Non-Stop - Leslie Odom Jr. _ Lin-Manuel Miranda _ Renée Elise Goldsberry _ Phillipa Soo _ Christopher Jackson _ Original Broadway Cast of Hamilton.flac',
  'untitled - Restless (Explicit).m4a'
]

const out = []
for (const name of names) {
  const file = `${DIR}\\${name}`
  let url = null
  try {
    const r = await window.api.player.getUrl({
      song: {
        id: `local_${file}`,
        platform: 'local',
        songmid: file,
        localPath: file,
        name,
        singer: 'x',
        albumName: '',
        duration: 0,
        qualities: ['320k']
      },
      quality: '320k'
    })
    url = r?.url ?? null
  } catch (e) {
    out.push({ 文件: name.slice(0, 40), 取流失败: String(e.message).slice(0, 70) })
    continue
  }
  if (!url) {
    out.push({ 文件: name.slice(0, 40), 取流失败: '没有返回地址' })
    continue
  }

  let contentType = null
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1023' } })
    contentType = res.headers.get('content-type')
    await res.arrayBuffer()
  } catch {
    /* ignore */
  }

  const el = new Audio()
  el.preload = 'metadata'
  el.src = url
  const decoded = await new Promise((resolve) => {
    const done = (how) =>
      resolve({
        结束: how,
        readyState: el.readyState,
        duration: Number.isFinite(el.duration) ? Math.round(el.duration) : null,
        错误码: el.error?.code ?? null,
        错误信息: el.error?.message ?? null
      })
    el.addEventListener('loadedmetadata', () => done('ok'), { once: true })
    el.addEventListener('error', () => done('error'), { once: true })
    setTimeout(() => done('超时'), 8000)
  })

  out.push({
    文件: name.slice(0, 42),
    mime: contentType,
    能解码: decoded.readyState >= 2 && decoded.错误码 === null,
    秒: decoded.duration,
    错误码: decoded.错误码,
    错误信息: decoded.错误信息
  })
  await sleep(150)
}

return JSON.stringify(
  {
    结果: out,
    统计: {
      总数: out.length,
      能解码: out.filter((x) => x.能解码).length,
      不能解码: out.filter((x) => x.能解码 === false).length,
      取流失败: out.filter((x) => x.取流失败).length
    }
  },
  null,
  1
)
