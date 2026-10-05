/** 实测取流解析速度：冷启动 / 重复 / 各音质档 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
const rail = (l) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(l)
  )
const rows = () => [...document.querySelectorAll('.results .row')]

rail('搜索')?.click()
await sleep(2500)
if (rows().length === 0) {
  const inp = document.querySelector('.search-box input')
  inp.focus()
  inp.value = '周杰伦'
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(250)
  inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    if (rows().length > 0) break
  }
}
const list = rows()
out.搜索结果行数 = list.length
if (list.length < 4) return JSON.stringify(out, null, 1)

/** 从第一列点击取歌：直接用播放按钮背后的歌曲数据不方便，改用搜索接口拿原始 song */
const songs = []
for (let i = 0; i < 5; i += 1) {
  const t = (list[i].querySelector('.title')?.textContent ?? '').trim()
  const s = (list[i].querySelector('.singer, .sub-title')?.textContent ?? '').trim()
  songs.push({ i, t, s })
}
out.前几条 = songs

// 直接走 store 取流：先播放一首让 urlInfo 有值，再用 window.api 计时
if (!window.api?.player?.getUrl) return JSON.stringify({ 错误: '没有 window.api.player.getUrl' }, null, 1)

// 从 DOM 拿不到完整 Song 对象，改为通过播放触发 + 读 urlInfo 的位置来测
const times = []
for (let i = 0; i < 4; i += 1) {
  const btn = list[i]?.querySelector('.col-actions button[title="播放"]')
  if (!btn) continue
  const t0 = performance.now()
  btn.click()
  // 等到真正开始播放（进度读数出现）
  let ms = null
  for (let k = 0; k < 200; k += 1) {
    await sleep(25)
    const st = document.querySelector('.pb-state')
    if (st && st.getAttribute('data-playing') === 'true') {
      ms = Math.round(performance.now() - t0)
      break
    }
  }
  times.push({ 第几首: i + 1, 曲目: songs[i]?.t, 点击到出声毫秒: ms })
  await sleep(1500)
}

out.冷启动取流 = times
const valid = times.map((x) => x.点击到出声毫秒).filter((x) => typeof x === 'number')
out.统计 = valid.length
  ? {
      样本数: valid.length,
      最快: Math.min(...valid) + 'ms',
      最慢: Math.max(...valid) + 'ms',
      平均: Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) + 'ms'
    }
  : '没有样本'

// 重复播放同一首（应命中缓存）
const t0 = performance.now()
list[0]?.querySelector('.col-actions button[title="播放"]')?.click()
let warmMs = null
for (let k = 0; k < 200; k += 1) {
  await sleep(25)
  const st = document.querySelector('.pb-state')
  if (st && st.getAttribute('data-playing') === 'true') {
    warmMs = Math.round(performance.now() - t0)
    break
  }
}
out.命中缓存后再播 = warmMs === null ? '未测到' : warmMs + 'ms'

return JSON.stringify(out, null, 1)
