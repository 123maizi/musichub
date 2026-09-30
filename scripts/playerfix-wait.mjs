/**
 * 探针（player-fix）：等音源装载完（新 profile 首次启动要导入内置音源）。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const sources = pinia._s.get('sources')

const started = Date.now()
let last = 0
for (let i = 0; i < 60; i += 1) {
  const list = sources?.list ?? []
  last = list.length
  const ready = list.filter((s) => s.status === 'ready').length
  if (ready > 0 && !sources.loading) {
    return JSON.stringify({ 音源数: list.length, ready, loading: sources.loading, 等待秒: Math.round((Date.now() - started) / 1000) })
  }
  await sleep(2000)
}
return JSON.stringify({ 音源数: last, 超时: true, 等待秒: Math.round((Date.now() - started) / 1000), loading: sources?.loading })
