/**
 * 长时观察：点一次播放，然后每 2 秒采一次状态，看它会不会自己停、
 * 会不会报错、会不会自动切歌、进度会不会倒退。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

/* 先停掉当前播放，保证从零开始 */
await window.api.download.setConfig({})
window.location.hash = '#/downloads'
await sleep(2600)

const row = [...document.querySelectorAll('.task')][0]
if (!row) return JSON.stringify({ 错误: '没有任务行' })
const btn = [...row.querySelectorAll('button')].find((b) =>
  ['播放', '播放中'].includes(b.innerText.trim())
)
if (!btn) return JSON.stringify({ 错误: '没有播放按钮', 按钮: [...row.querySelectorAll('button')].map((b) => b.innerText.trim()) })

btn.click()
out['按钮文字'] = btn.innerText.trim()

const samples = []
for (let i = 0; i < 20; i += 1) {
  await sleep(2000)
  samples.push({
    t: (i + 1) * 2,
    时间: document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? '',
    曲名: document.querySelector('.now-title')?.innerText?.trim() ?? '',
    音源: document.querySelector('.src-name')?.innerText?.trim() ?? '',
    出错: document.querySelector('.error-strip')?.innerText?.replace(/\s+/g, ' ').slice(0, 90) ?? '',
    audio: (() => {
      const a = document.querySelector('audio')
      return a
        ? { readyState: a.readyState, paused: a.paused, 错误码: a.error?.code ?? null, 秒: Number(a.currentTime.toFixed(1)) }
        : 'DOM 里没有 audio 元素'
    })()
  })
}
out['每2秒采样'] = samples

/* 判据 */
const secs = samples.map((s) => {
  const m = /(\d+):(\d+)/.exec(s.时间)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
})
out['时间读数'] = secs
out['进度是否持续推进'] = secs.every((v, i) => i === 0 || v === null || secs[i - 1] === null || v >= secs[i - 1])
out['是否出现错误'] = samples.some((s) => s.出错.length > 0)
out['曲名是否变过'] = new Set(samples.map((s) => s.曲名)).size > 1
out['最终读数'] = samples[samples.length - 1].时间

return JSON.stringify(out, null, 1)
