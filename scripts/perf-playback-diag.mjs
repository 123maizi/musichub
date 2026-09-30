/** 双击播放诊断：读播放器状态 + audio 元素真实情况 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const player = pinia._s.get('player')
const a = document.querySelector('audio')
return {
  current: player.current ? { id: player.current.id, name: player.current.name, platform: player.current.platform } : null,
  playing: player.playing,
  duration: player.duration,
  progress: player.progress,
  error: player.error ?? null,
  urlInfo: player.urlInfo ?? null,
  audio: a
    ? {
        src: (a.src || '').slice(0, 140),
        paused: a.paused,
        currentTime: Number(a.currentTime.toFixed(2)),
        readyState: a.readyState,
        networkState: a.networkState,
        duration: Number.isFinite(a.duration) ? Number(a.duration.toFixed(2)) : String(a.duration),
        errorCode: a.error?.code ?? null,
        errorMessage: a.error?.message ?? null
      }
    : null
}
