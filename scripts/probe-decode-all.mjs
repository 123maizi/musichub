/**
 * 用 Chromium 实际解码下载目录里的每个文件。
 * 结构正常不代表能播 —— 这一步才能看出「下到的是残缺流」之类的问题。
 */
const dir = 'C:/Users/18509/Desktop/歌曲下载/'

// 通过主进程列目录不可行，这里写死已知文件名（脚本仅用于诊断）
const files = [
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
for (const name of files) {
  const url = 'file:///' + encodeURI(dir + name)
  const r = await new Promise((resolve) => {
    const a = document.createElement('audio')
    a.preload = 'metadata'
    const t = setTimeout(() => resolve({ ok: false, err: '超时（可能无法解码）' }), 8000)
    a.onloadedmetadata = () => {
      clearTimeout(t)
      resolve({
        ok: true,
        dur: Math.round(a.duration * 10) / 10,
        readyState: a.readyState,
        seekable: a.seekable.length > 0 ? Math.round(a.seekable.end(0)) : 0
      })
    }
    a.onerror = () => {
      clearTimeout(t)
      const code = a.error?.code ?? '?'
      resolve({ ok: false, err: `错误码 ${code}` })
    }
    a.src = url
  })
  out.push({ 文件: name.length > 42 ? name.slice(0, 42) + '…' : name, ...r })
}

return JSON.stringify(out, null, 1)
