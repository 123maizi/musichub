/**
 * 探针（player-fix）：监听器是否会随着播放次数累加。
 *
 * 这个探针必须在**页面刚加载、播放器还没建 audio 元素之前**安装计数补丁，
 * 所以它自带一次 reload：第一次调用只会安排刷新，第二次调用才真正测。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 计数补丁必须在「播放器创建 audio 元素之前」装好，所以先刷一次页面。
 * 用 sessionStorage 做标记：刷新前只安排刷新，刷新后才真正开测。
 */
if (sessionStorage.getItem('pf-listeners-armed') !== '1') {
  sessionStorage.setItem('pf-listeners-armed', '1')
  setTimeout(() => location.reload(), 400)
  return JSON.stringify({ 阶段: '已安排刷新，请稍后重跑本探针' })
}

if (!window.__pfListeners) {
  window.__pfListeners = { add: {}, remove: {}, ids: new WeakMap(), next: 1 }
  const add = HTMLMediaElement.prototype.addEventListener
  const remove = HTMLMediaElement.prototype.removeEventListener
  const key = (el, type) => {
    const st = window.__pfListeners
    if (!st.ids.has(el)) st.ids.set(el, `el${st.next++}`)
    return `${st.ids.get(el)}:${type}`
  }
  HTMLMediaElement.prototype.addEventListener = function (type, ...rest) {
    const k = key(this, type)
    window.__pfListeners.add[k] = (window.__pfListeners.add[k] ?? 0) + 1
    return add.call(this, type, ...rest)
  }
  HTMLMediaElement.prototype.removeEventListener = function (type, ...rest) {
    const k = key(this, type)
    window.__pfListeners.remove[k] = (window.__pfListeners.remove[k] ?? 0) + 1
    return remove.call(this, type, ...rest)
  }
  // 顺带捕获播放器内部那个不挂 DOM 的音频元素
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) {
    window.__pfAudio = this
    return origPlay.apply(this, args)
  }
}

const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')

/** 当前元素上每种监听器的净数量 */
function net() {
  const st = window.__pfListeners
  const el = window.__pfAudio
  if (!el) return null
  const id = st.ids.get(el)
  if (!id) return null
  const out = {}
  for (const k of Object.keys(st.add)) {
    if (!k.startsWith(`${id}:`)) continue
    out[k.slice(id.length + 1)] = st.add[k] - (st.remove[k] ?? 0)
  }
  return out
}

/* 还没有 audio 元素 → 说明还没开始播放，补丁已经装好，直接往下走 */
if (!window.__pfAudio) {
  /* 播放会在下面的 player.play() 里发生，元素届时会被捕获 */
}

const res = await window.api.search.search({ keyword: '晴天', limit: 10 })
const pool = []
for (const p of res.platforms) {
  for (const s of p.songs) if (s.duration >= 150 && s.duration <= 400) pool.push(s)
}
const picked = []
for (const s of pool) {
  if (picked.length >= 3) break
  try {
    await window.api.player.getUrl({ song: s, quality: '320k' })
    picked.push(s)
  } catch {
    /* 跳过取不到流的 */
  }
}
if (picked.length < 3) return JSON.stringify({ 错误: '可取流的歌不足 3 首', 数量: picked.length })

const stages = []
const snap = async (tag) => {
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    if (window.__pfAudio && window.__pfAudio.readyState >= 2) break
  }
  stages.push({ 阶段: tag, 净监听器: net(), 累计add: { ...window.__pfListeners.add }, 累计remove: { ...window.__pfListeners.remove } })
}

await player.play(picked[0])
await snap('第1首播放后')
await player.play(picked[1])
await snap('第2首播放后')
await player.play(picked[2])
await snap('第3首播放后')

/* 再逼一次换源（走 waitForMetadata 的临时监听器），看它有没有漏摘 */
const el = window.__pfAudio
const realGet = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration').get
let fake = null
Object.defineProperty(el, 'duration', {
  configurable: true,
  get() {
    return fake === null ? realGet.call(el) : fake
  }
})
player.seek(15)
await sleep(800)
fake = picked[2].duration * 0.5
el.dispatchEvent(new Event('loadedmetadata'))
fake = null
await snap('强制换源后')
delete el['duration']

const first = stages[0].净监听器
sessionStorage.removeItem('pf-listeners-armed')
return JSON.stringify(
  {
    播放过的三首: picked.map((s) => `${s.name}/${s.platform}/${s.duration}s`),
    各阶段净监听器: stages.map((s) => ({ 阶段: s.阶段, 净监听器: s.净监听器 })),
    第1首到第3首是否累加: JSON.stringify(stages[0].净监听器) !== JSON.stringify(stages[2].净监听器),
    换源后是否比第3首更多: JSON.stringify(stages[2].净监听器) !== JSON.stringify(stages[3].净监听器),
    累计add: stages[3].累计add,
    累计remove: stages[3].累计remove,
    最终净监听器: stages[3].净监听器,
    第1首净监听器: first
  },
  null,
  1
)
