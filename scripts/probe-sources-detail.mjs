/** 逐个输出音源明细：名称 / 状态 / 平台 / 最高音质 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rail = (l) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(l)
  )
rail('音源')?.click()
await sleep(5000)
for (let i = 0; i < 30; i += 1) {
  await sleep(1200)
  if (document.querySelectorAll('.item').length > 10) break
}

const items = [...document.querySelectorAll('.item')]
const rows = items.map((el) => {
  const name = (el.querySelector('.name')?.textContent ?? '').trim()
  const sub = (el.querySelector('.sub-line')?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const plats = [...el.querySelectorAll('.platforms .chip, .platforms span, .platforms *')]
    .map((x) => (x.textContent ?? '').trim())
    .filter((t) => t && t.length <= 6)
  const badges = [...el.querySelectorAll('.accent, .ok')].map((x) => (x.textContent ?? '').trim())
  const failed = /失败/.test(el.innerText)
  return {
    名称: name.slice(0, 46),
    状态: failed ? '加载失败' : '可用',
    平台: [...new Set(plats)].join(' '),
    徽标: [...new Set(badges)].join(' '),
    备注: sub.slice(0, 70)
  }
})

const MINE = [
  'gdstudio', 'HYWmusic_公益版', '玉宁熙', 'stellarwave', 'xinghai-music', '全豆要',
  '墨澜', '屿溪', '幻音', '念心', '收集の聚合', '溯音', '独家音源', '稳定版音源',
  '统一音乐源', '聚合API接口', '裤佬SVIP', '西瓜聚合', '非常刀', '𝖧౿'
]

const mine = rows.filter((r) => MINE.some((k) => r.名称.includes(k)))
const failed = rows.filter((r) => r.状态 === '加载失败')

return JSON.stringify(
  {
    总计: rows.length,
    可用: rows.filter((r) => r.状态 === '可用').length,
    加载失败数: failed.length,
    加载失败清单: failed.map((r) => r.名称),
    本批20个_可用: mine.filter((r) => r.状态 === '可用').length,
    本批20个_失败: mine.filter((r) => r.状态 === '加载失败').map((r) => r.名称),
    本批明细: mine,
    内置音源示例: rows.filter((r) => !MINE.some((k) => r.名称.includes(k))).slice(0, 6)
  },
  null,
  1
)
