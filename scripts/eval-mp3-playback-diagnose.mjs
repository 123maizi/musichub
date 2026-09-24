/**
 * 让 Chromium 自己说为什么播不了。
 * 不只看界面提示 —— 直接读 <audio> 的 error.code / error.message，
 * 再看代理返回的 Content-Type 和 Range，以及能否 seek。
 */
const FILE = 'C:\\Users\\18509\\Desktop\\歌曲下载\\Corbon Amodio - lucy~.mp3'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

/* 1. 走真实取流接口拿地址 */
let url = null
try {
  const r = await window.api.player.getUrl({
    song: {
      id: `local_${FILE}`,
      platform: 'local',
      songmid: FILE,
      localPath: FILE,
      name: 'lucy~',
      singer: 'Corbon Amodio',
      albumName: '',
      duration: 0,
      qualities: ['320k']
    },
    quality: '320k'
  })
  url = r?.url ?? null
  out['1_取流结果'] = { 成功: Boolean(url), 地址: url ? url.slice(0, 80) : null, ext: r?.ext ?? null }
} catch (e) {
  out['1_取流结果'] = { 成功: false, 错误: String(e.message).slice(0, 120) }
}

if (url) {
  /* 2. 响应头 */
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-2047' } })
    const h = {}
    res.headers.forEach((v, k) => (h[k] = v))
    out['2_响应头'] = { status: res.status, ...h }
    await res.arrayBuffer()
  } catch (e) {
    out['2_响应头'] = `fetch 异常: ${String(e).slice(0, 80)}`
  }

  /* 3. 让 Chromium 真正解码 */
  const el = new Audio()
  el.preload = 'metadata'
  el.src = url
  const result = await new Promise((resolve) => {
    const done = (how) =>
      resolve({
        结束方式: how,
        readyState: el.readyState,
        networkState: el.networkState,
        duration: Number.isFinite(el.duration) ? Math.round(el.duration) : null,
        错误码: el.error?.code ?? null,
        错误信息: el.error?.message ?? null,
        currentSrc: (el.currentSrc || '').slice(0, 60)
      })
    el.addEventListener('loadedmetadata', () => done('loadedmetadata'), { once: true })
    el.addEventListener('error', () => done('error'), { once: true })
    setTimeout(() => done('超时 8s'), 8000)
  })
  out['3_解码结果'] = result

  /* 4. 真播一下 */
  const el2 = new Audio()
  el2.src = url
  try {
    await el2.play()
    await sleep(2500)
    out['4_播放'] = {
      当前秒: Number(el2.currentTime.toFixed(1)),
      时长: Number.isFinite(el2.duration) ? Math.round(el2.duration) : null,
      错误码: el2.error?.code ?? null
    }
  } catch (e) {
    out['4_播放'] = { 播放异常: String(e.message).slice(0, 120), 错误码: el2.error?.code ?? null }
  }
  el2.pause?.()
}

/* 5. 应用自己的播放器怎么说 */
window.location.hash = '#/downloads'
await sleep(2500)
const rows = [...document.querySelectorAll('.task')]
out['5_任务行'] = rows.map((r) => r.innerText.replace(/\s+/g, ' ').slice(0, 90))
const target = rows.find((r) => r.innerText.includes('lucy'))
if (target) {
  const btn = [...target.querySelectorAll('button')].find((b) =>
    ['播放', '播放中', '重新下载'].includes(b.innerText.trim())
  )
  out['6_按钮'] = btn?.innerText.trim() ?? '(无)'
  if (btn && btn.innerText.trim() !== '重新下载') {
    btn.click()
    await sleep(5000)
    out['7_应用内播放'] = {
      时间: document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? '',
      音源: document.querySelector('.src-name')?.innerText?.trim() ?? '',
      出错: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 140) ?? ''
    }
  }
}

return JSON.stringify(out, null, 1)
