/** 验证改过标签的文件还能不能解码（Chromium 实测） */
const dir = 'F:/MusicHub/.tmp/tagtest/'
const files = ['tagged.m4a', 'tagged.mp3', 'tagged.flac']

const out = []
for (const f of files) {
  const r = await new Promise((resolve) => {
    const a = document.createElement('audio')
    a.preload = 'metadata'
    const t = setTimeout(() => resolve({ ok: false, err: '超时' }), 8000)
    a.onloadedmetadata = () => {
      clearTimeout(t)
      resolve({ ok: true, dur: Math.round(a.duration * 10) / 10, readyState: a.readyState })
    }
    a.onerror = () => {
      clearTimeout(t)
      resolve({ ok: false, err: `错误码 ${a.error?.code}` })
    }
    a.src = 'file:///' + encodeURI(dir + f)
  })
  out.push({ 文件: f, ...r })
}

return JSON.stringify(out, null, 1)
