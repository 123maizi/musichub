/**
 * 探针：键盘寻求的验收（Lead 的判据）。
 *  · 聚焦后按 →，每次正好 5 秒、方向正确
 *  · 位置与 store 一致（不是从过期基准起步）
 *  · 播放期间 range 的 value 不被写（不绑 :value）
 * stepUp(1) 就是浏览器 ArrowRight 的默认动作；再手动派发 input/change，
 * 等价于键盘操作触发的两个事件。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')

const el = document.querySelector('.progress-input')
if (!el) return JSON.stringify({ 错误: '找不到 .progress-input' })

const out = { 步长属性: el.step, 上限属性: el.max, 时长: +player.duration.toFixed(1), 初始store秒: +player.currentTime.toFixed(2) }

/* 1) 聚焦即同步基准 */
el.focus()
await sleep(150)
out.聚焦后DOM值 = Number(el.value)
out.聚焦后与store差 = +(Number(el.value) - player.currentTime).toFixed(2)

/* 2) 连按 3 次 →（每次 1 步） */
const steps = []
for (let i = 0; i < 3; i += 1) {
  const beforeStore = +player.currentTime.toFixed(2)
  const beforeDom = Number(el.value)
  el.stepUp(1)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(250)
  steps.push({
    第几次: i + 1,
    DOM步进: Number(el.value) - beforeDom,
    store跳变: +(player.currentTime - beforeStore).toFixed(2),
    跳后DOM: Number(el.value),
    跳后store: +player.currentTime.toFixed(2),
    DOM与store差: +(Number(el.value) - player.currentTime).toFixed(2)
  })
}
out.按键序列 = steps
out.每次是否正好5秒 = steps.every((s) => s.DOM步进 === 5)
out.方向正确 = steps.every((s, i) => i === 0 || s.跳后store > steps[i - 1].跳后store)
out.位置与store一致 = steps.every((s) => Math.abs(s.DOM与store差) <= 2.5)

/* 3) 播放 3 秒，range 的 value 不应被写 */
const v0 = el.value
await sleep(3000)
out.播放3秒后value是否被写 = el.value !== v0
out.播放3秒进度变化 = +(player.progress - 0).toFixed(2)
out.收尾 = { store秒: +player.currentTime.toFixed(2), DOM值: Number(el.value), playing: player.playing, 错误: player.error }
return JSON.stringify(out, null, 1)
