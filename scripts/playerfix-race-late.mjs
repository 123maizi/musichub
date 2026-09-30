/**
 * 探针（player-fix）：接续 race 阶段2 —— 等那个「伪造 songmid 的迟到请求」
 * 真正落定，看它会不会把正在播的 B 写成错误状态。
 * 只读观察，不碰播放器。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')

const started = Date.now()
const bad = []
const samples = []
for (let i = 0; i < 45; i += 1) {
  await sleep(2000)
  const s = {
    s: Math.round((Date.now() - started) / 1000),
    曲: player.current?.name ?? null,
    曲id: player.current?.id ?? null,
    playing: player.playing,
    loading: player.loading,
    秒: +player.currentTime.toFixed(2),
    错误: player.error
  }
  if (s.错误 || !s.playing) bad.push(s)
  if (i % 5 === 0) samples.push(`${s.s}s ${s.曲} playing=${s.playing} 秒=${s.秒} 错误=${s.错误 ?? '-'}`)
}

return JSON.stringify(
  {
    观察秒: Math.round((Date.now() - started) / 1000),
    出现异常的次数: bad.length,
    异常样例: bad.slice(0, 5),
    最终: {
      曲: player.current?.name ?? null,
      playing: player.playing,
      秒: +player.currentTime.toFixed(2),
      错误: player.error,
      音源: player.urlInfo?.sourceId ?? null
    },
    采样: samples
  },
  null,
  1
)
