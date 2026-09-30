/**
 * 兜底链路端到端验证。
 *
 * 做法：在真实列表里挑一行「平台封面地址正常」的，人为把它的 <img> 打断两次，
 * 观察 CoverImage 是否按设计逐级兜底：
 *   第 1 次失败 → 本地流代理（同一个远程地址，服务端补 Referer/UA）
 *   第 2 次失败 → 跨平台补图（换一张真的、而且歌名歌手都对得上的封面）
 * 全程记录这一行的标题，确认兜底的是**同一首歌**，没有张冠李戴。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BROKEN = 'https://127.0.0.1:1/definitely-not-an-image.jpg'

function store() {
  const vueApp = document.querySelector('#app')?.__vue_app__
  return vueApp?.config?.globalProperties?.$pinia?._s?.get?.('search') ?? null
}

location.hash = '#/search'
await sleep(500)
const input = document.querySelector('.search-box input')
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
setter.call(input, '周杰伦')
input.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(150)
document.querySelector('.search-box button.primary')?.click()

for (let i = 0; i < 40; i += 1) {
  await sleep(500)
  if (document.querySelectorAll('.results .row').length >= 100) break
}
await sleep(6000)

/** 找一行：有平台封面、当前显示的就是平台地址 */
const songs = store()?.visibleSongs ?? []
const domRows = [...document.querySelectorAll('.results .row')]
let targetIndex = -1
for (let i = 0; i < domRows.length; i += 1) {
  const song = songs[i]
  if (!song?.picUrl) continue
  const img = domRows[i].querySelector('.mini-cover img')
  if (img && (img.getAttribute('src') || '') === String(song.picUrl) && img.naturalWidth > 0) {
    targetIndex = i
    break
  }
}
if (targetIndex < 0) return JSON.stringify({ 结论: '找不到「平台封面正常」的行，无法验证' }, null, 1)

const song = songs[targetIndex]
const steps = []

async function readRow(label) {
  for (let i = 0; i < 20; i += 1) {
    await sleep(600)
    const row = [...document.querySelectorAll('.results .row')][targetIndex]
    const img = row?.querySelector('.mini-cover img')
    if (img && img.complete && img.naturalWidth > 0) {
      const src = String(img.getAttribute('src'))
      return {
        阶段: label,
        标题: row.querySelector('.title')?.innerText?.trim() ?? '?',
        歌手: row.querySelector('.singer')?.innerText?.trim() ?? '?',
        地址: src,
        走代理: src.includes('127.0.0.1'),
        加载成功: true,
        尺寸: `${img.naturalWidth}x${img.naturalHeight}`
      }
    }
  }
  const row = [...document.querySelectorAll('.results .row')][targetIndex]
  const img = row?.querySelector('.mini-cover img')
  return {
    阶段: label,
    标题: row?.querySelector('.title')?.innerText?.trim() ?? '?',
    地址: img ? String(img.getAttribute('src')) : '(无 img，退化成占位图标)',
    加载成功: false
  }
}

async function breakOnce(times) {
  const row = [...document.querySelectorAll('.results .row')][targetIndex]
  const img = row?.querySelector('.mini-cover img')
  if (!img) return false
  for (let i = 0; i < times; i += 1) {
    img.src = BROKEN + `?t=${i}-${Math.random()}`
  }
  return true
}

steps.push({
  阶段: '基线',
  标题: song.name,
  歌手: song.singer,
  平台: song.platform,
  平台地址: String(song.picUrl)
})

await breakOnce(1)
steps.push(await readRow('第 1 次打断后（预期：走本地代理兜底）'))

await breakOnce(2)
steps.push(await readRow('第 2 次打断后（预期：跨平台补图兜底）'))

const finalRow = [...document.querySelectorAll('.results .row')][targetIndex]
return JSON.stringify(
  {
    目标行: `${targetIndex + 1} ${song.name} - ${song.singer} (${song.platform})`,
    兜底过程: steps,
    行仍然属于同一首歌: (finalRow?.querySelector('.title')?.innerText?.trim() ?? '') === song.name
  },
  null,
  1
)
