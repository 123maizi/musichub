/** 当前下载目录里所有音频文件的解码实测 */
const DIR = 'C:/Users/18509/Desktop/歌曲下载/'
const FILES = [
  '20 Min - Lil Uzi Vert.flac',
  'Corbon Amodio - lucy~.mp3',
  'Hasta Que Llegue la Muerte - Depresión Sonora.mp3',
  'Leslie Odom, Jr.、Lin-Manuel Miranda、Phillipa Soo、Christopher Jackson、Original Broadway Cast of Hamilton、Renee Elise Goldsberry - Non-Stop (1).flac',
  'Leslie Odom, Jr.、Lin-Manuel Miranda、Phillipa Soo、Christopher Jackson、Original Broadway Cast of Hamilton、Renee Elise Goldsberry - Non-Stop.mp3',
  'Lil Wayne、Bobby V.、Kidd Kidd - Mrs. Officer (Explicit).m4a',
  "Mama's Boy - Ratter.mp3",
  'Meant To Be - Cuntsniffer.mp3',
  'Non-Stop - Leslie Odom Jr. _ Lin-Manuel Miranda _ Renée Elise Goldsberry _ Phillipa Soo _ Christopher Jackson _ Original Broadway Cast of Hamilton.flac',
  'untitled - Restless (Explicit).m4a',
  '周杰伦 - 稻香.m4a'
]

const out = []
for (const name of FILES) {
  const short = name.length > 46 ? name.slice(0, 46) + '…' : name
  const r = await new Promise((resolve) => {
    const a = document.createElement('audio')
    a.preload = 'metadata'
    const t = setTimeout(() => resolve({ r: '✗ 超时' }), 9000)
    a.onloadedmetadata = () => {
      clearTimeout(t)
      resolve({ r: `✓ ${Math.round(a.duration)} 秒`, state: a.readyState })
    }
    a.onerror = () => {
      clearTimeout(t)
      const code = a.error?.code
      resolve({
        r:
          code === 3 ? '✗ 解码失败' :
          code === 4 ? '✗ 源不支持' :
          code === 2 ? '✗ 网络错误' : `✗ 错误码 ${code}`
      })
    }
    a.src = 'file:///' + encodeURI(DIR + name)
  })
  out.push(`${String(r.r).padEnd(12)} readyState=${r.state ?? '-'}  ${short}`)
}

return JSON.stringify(out, null, 1)
