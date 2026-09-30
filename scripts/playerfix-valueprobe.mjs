/**
 * 定位：谁在每次渲染都写 input.value？（进度条布局残留的最后一个疑点）
 * 拦 HTMLInputElement.prototype.value 的 setter，统计写入次数，并抓 3 个调用栈。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')

if (!window.__pfValueProbe) {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  const stats = { sets: 0, same: 0, byClass: {}, stacks: [] }
  window.__pfValueProbe = stats
  Object.defineProperty(HTMLInputElement.prototype, 'value', {
    configurable: true,
    get: desc.get,
    set(v) {
      const cur = String(desc.get.call(this))
      stats.sets += 1
      if (cur === String(v)) stats.same += 1
      const cls = this.className || this.type
      stats.byClass[cls] = (stats.byClass[cls] ?? 0) + 1
      if (stats.stacks.length < 3) stats.stacks.push({ cls, from: cur, to: String(v), stack: String(new Error().stack).split('\n').slice(1, 6).join(' | ') })
      desc.set.call(this, v)
    }
  })
}

const stats = window.__pfValueProbe
const before = JSON.parse(JSON.stringify(stats))

for (let i = 0; i < 40; i += 1) {
  player.seek(40 + (i % 40) * 0.5)
  await sleep(20)
}
await sleep(300)

return JSON.stringify(
  {
    本次写入次数: stats.sets - before.sets,
    其中「写进去的值和当前值相同」: stats.same - before.same,
    按元素: stats.byClass,
    调用栈样例: stats.stacks,
    当前进度: +player.progress.toFixed(2),
    当前输入框值: document.querySelector('.progress-input')?.value ?? null,
    音量框值: document.querySelector('.volume')?.value ?? null
  },
  null,
  1
)
