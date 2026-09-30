/**
 * 诊断探针（player-fix）：确认「伪造 el.duration + 补发 loadedmetadata」这套手法
 * 真的作用在播放器那个元素上、真的能触达 store 的校验逻辑。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')

const el = window.__pfAudio
const out = {}
out.有元素 = !!el
out.元素src尾部 = el ? String(el.src).slice(-50) : null
out.urlInfo尾部 = player.urlInfo ? String(player.urlInfo.url).slice(-50) : null
out.src一致 = !!el && !!player.urlInfo && String(el.src).slice(-40) === String(player.urlInfo.url).slice(-40)
out.元素秒 = el ? +el.currentTime.toFixed(2) : null
out.store秒 = +player.currentTime.toFixed(2)
out.元素时长 = el ? el.duration : null
out.store时长 = +player.duration.toFixed(1)
out.当前曲时长 = player.current?.duration ?? null
out.playing = player.playing
out.错误 = player.error

if (!el) return JSON.stringify(out, null, 1)

/* 1) 装一个自己的 loadedmetadata 监听器，证明事件本身能派发到元素 */
let myListenerFired = 0
const mine = () => {
  myListenerFired += 1
}
el.addEventListener('loadedmetadata', mine)

/* 2) 伪装一个「不算片段」的时长（200s，> 0.6×250），看 store 是否收到 */
const realGet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration').get
let fake = null
const descBefore = Object.getOwnPropertyDescriptor(el, 'duration')
Object.defineProperty(el, 'duration', {
  configurable: true,
  get() {
    return fake === null ? realGet.call(el) : fake
  }
})
out.装了own属性 = !!Object.getOwnPropertyDescriptor(el, 'duration')?.get
out.定义前的own属性 = descBefore ? '已存在' : '无'

fake = 200
out.伪造后读到的时长 = el.duration
const storeDurationBefore = +player.duration.toFixed(1)
el.dispatchEvent(new Event('loadedmetadata'))
await sleep(600)
out.我自己监听器被触发次数 = myListenerFired
out.store时长_伪造200后 = +player.duration.toFixed(1)
out.store时长_事件前 = storeDurationBefore
out.store收到了事件 = +player.duration.toFixed(1) === 200
fake = null
await sleep(400)
out.store时长_撤销后 = +player.duration.toFixed(1)

el.removeEventListener('loadedmetadata', mine)
delete el['duration']
out.收尾 = { 真实时长: el.duration, 当前秒: +player.currentTime.toFixed(2), 错误: player.error }
return JSON.stringify(out, null, 1)
