/**
 * 复现「下载的歌曲播放失败」。
 *
 * 走的是应用真实的本地播放通道：
 *   构造本地歌曲 → 取流（本地流代理）→ 真的用 <audio> 加载
 * 每一步都单独报告，才能看出是哪一环断的。
 */
const DIR = 'C:\\Users\\18509\\Desktop\\歌曲下载'
const FILES = [
  '20 Min - Lil Uzi Vert.flac',
  'Army Of Lovers - Crucified.mp3',
  'Hasta Que Llegue la Muerte - Depresión Sonora.mp3',
  'Lotus Juice_高橋あず美_アトラスサウンドチーム_ATLUS GAME MUSIC - Mass Destruction -Reload-.mp3',
  "Mama's Boy - Ratter.mp3",
  'Meant To Be - Cuntsniffer.mp3',
  'Non-Stop - Leslie Odom Jr. _ Lin-Manuel Miranda _ Renée Elise Goldsberry _ Phillipa Soo _ Christopher Jackson _ Original Broadway Cast of Hamilton.flac',
  '蛋堡 - 收敛水.m4a'
]

const out = []

for (const name of FILES) {
  const path = DIR + '\\' + name
  const row = { 文件: name.length > 34 ? name.slice(0, 34) + '…' : name }

  const song = {
    id: 'local_' + path,
    platform: 'local',
    songmid: path,
    localPath: path,
    name: name.replace(/\.[^.]+$/, ''),
    singer: '本地',
    albumName: '',
    duration: 0,
    qualities: ['320k']
  }

  /* 第一步：取流（走本地流代理） */
  let url = ''
  try {
    const r = await window.api.player.getUrl({ song })
    url = String(r.url)
    row.取流 = url.startsWith('http://127.0.0.1') ? '✓ 本地代理地址' : `? ${url.slice(0, 40)}`
  } catch (err) {
    row.取流 = '✗ ' + String(err.message).replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 50)
    out.push(row)
    continue
  }

  /* 第二步：代理到底能不能读到文件 */
  try {
    const probe = await window.api.player.probe(url)
    row.代理探活 = probe?.ok
      ? `✓ HTTP ${probe.status}  ${probe.size ? Math.round(probe.size / 1024) + 'KB' : '无长度'}  ${probe.contentType ?? ''}`
      : `✗ HTTP ${probe.status ?? 0} ${probe.error ?? ''}`
  } catch (err) {
    row.代理探活 = '✗ ' + String(err.message).slice(0, 60)
  }

  /* 第三步：真的用音频元素加载 */
  row.播放 = await new Promise((resolve) => {
    const a = document.createElement('audio')
    a.preload = 'metadata'
    const t = setTimeout(() => resolve('✗ 超时（8 秒没出元数据）'), 8000)
    a.onloadedmetadata = () => {
      clearTimeout(t)
      resolve(`✓ 可播放 ${Math.round(a.duration)} 秒 (readyState=${a.readyState})`)
    }
    a.onerror = () => {
      clearTimeout(t)
      const code = a.error?.code
      const text =
        code === 1 ? 'MEDIA_ERR_ABORTED' :
        code === 2 ? 'MEDIA_ERR_NETWORK' :
        code === 3 ? 'MEDIA_ERR_DECODE（解码失败）' :
        code === 4 ? 'MEDIA_ERR_SRC_NOT_SUPPORTED（源不支持）' : `错误码 ${code}`
      resolve(`✗ ${text}`)
    }
    a.src = url
  })

  out.push(row)
}

return JSON.stringify(out, null, 1)
