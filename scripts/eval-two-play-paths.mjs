/**
 * 把「播放」和「用系统播放器」两条路都走一遍，并核对任务记录与磁盘是否一致。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

const tasks = await window.api.download.list()
const audit = await window.api.download.audit()
out['1_任务记录'] = tasks.map((t) => ({
  文件: t.fileName,
  状态: t.status,
  请求档位: t.quality,
  音源实给: t.actualQuality ?? null,
  文件存在: audit?.[t.id]?.exists ?? null,
  字节: audit?.[t.id]?.size ?? null,
  目录: t.savePath.slice(0, t.savePath.lastIndexOf('\\'))
}))
out['2_下载目录设置'] = (await window.api.download.getConfig()).dir
out['3_当前格式设置'] = (await window.api.download.getConfig()).preferQuality

/* 界面上的按钮 */
window.location.hash = '#/downloads'
await sleep(2600)
const rows = [...document.querySelectorAll('.task')]
out['4_界面行数'] = rows.length
out['5_每行的按钮'] = rows.map((r) => ({
  文本: r.innerText.replace(/\s+/g, ' ').slice(0, 70),
  按钮: [...r.querySelectorAll('button')].map((b) => b.innerText.trim())
}))

/* 应用内播放 */
const row = rows[0]
if (row) {
  const btn = [...row.querySelectorAll('button')].find((b) => b.innerText.trim() === '播放')
  if (btn) {
    btn.click()
    await sleep(5000)
    out['6_应用内播放'] = {
      时间: document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? '',
      音源: document.querySelector('.src-name')?.innerText?.trim() ?? '',
      曲名: document.querySelector('.now-title')?.innerText?.trim() ?? '',
      出错: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 140) ?? ''
    }
  }
}

/* 用系统播放器打开 */
const openBtn = row && [...row.querySelectorAll('button')].find((b) => b.innerText.includes('系统播放器'))
if (openBtn) {
  const t = tasks[0]
  try {
    const r = await window.api.download.openFile(t.savePath)
    out['7_系统播放器_openPath返回值'] = r === '' || r === undefined || r === null ? '空字符串 = 成功交给系统' : String(r).slice(0, 120)
  } catch (e) {
    out['7_系统播放器_openPath返回值'] = `异常: ${String(e.message).slice(0, 120)}`
  }
} else {
  out['7_系统播放器_openPath返回值'] = '界面上没有这个按钮'
}

return JSON.stringify(out, null, 1)
