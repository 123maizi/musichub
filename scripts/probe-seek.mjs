/**
 * 验证两件事：
 *   A. 拖进度条不再「从头播放 / 换歌」（重点：拖到 100% 与 95%）
 *   B. 播放条进度条常显、已播放段是蓝色
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const title = () => document.querySelector('.now-title')?.innerText?.trim() ?? ''
const timeRow = () => document.querySelector('.time-row')?.innerText?.replace(/\s+/g, ' ') ?? ''
const src = () => document.querySelector('.src-name')?.innerText ?? ''
const bar = () => document.querySelector('.progress-input')

/* ---------- A. 拖动 ---------- */
const before = { title: title(), src: src(), time: timeRow() }
const log = []

for (const pct of [30, 60, 90, 95, 100]) {
  const el = bar()
  el.value = String(pct)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(120)
  el.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(1600)

  log.push({
    拖动到: `${pct}%`,
    落点: timeRow(),
    曲目: title(),
    换歌了吗: title() !== before.title ? '⚠ 换了' : '否',
    音源: src()
  })
  await sleep(1400)
}

/* ---------- B. 进度条外观 ---------- */
const track = document.querySelector('.progress-track')
const fill = document.querySelector('.progress-fill')
const rail = document.querySelector('.progress-rail')
const knob = document.querySelector('.progress-knob')

const cs = (el) => (el ? getComputedStyle(el) : null)
const fillStyle = cs(fill)
const railStyle = cs(rail)

return JSON.stringify(
  {
    拖动: { 起始: before, log },
    进度条: {
      存在: {
        轨道容器: !!track,
        底槽: !!rail,
        已播放段: !!fill,
        圆点: !!knob
      },
      已播放段颜色: fillStyle?.backgroundColor ?? null,
      底槽颜色: railStyle?.backgroundColor ?? null,
      已播放段宽度: fill ? fill.style.width : null,
      圆点可见性: cs(knob) ? { opacity: cs(knob).opacity, transform: cs(knob).transform } : null,
      进度条是否在可视区内: track ? track.getBoundingClientRect().height > 0 : false
    }
  },
  null,
  1
)
