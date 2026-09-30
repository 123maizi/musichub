/**
 * 探针（player-fix 专用）：确认能从页面里拿到 player store 与 <audio> 实例。
 *
 * 为什么要这么绕：播放器用的是 `new Audio()`，元素不在 DOM 里，
 * document.querySelector('audio') 永远是 null；
 * 而 store 在 pinia 里，可以从 __vue_app__ 上拿到。
 */
const app = document.querySelector('#app')?.__vue_app__
const pinia = app?.config.globalProperties?.$pinia
const player = pinia?._s?.get('player')

// 捕获播放器内部那个不挂 DOM 的音频元素：拦住 play() 把 this 记下来
if (!window.__pfAudio) {
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) {
    window.__pfAudio = this
    return origPlay.apply(this, args)
  }
}

return JSON.stringify(
  {
    有vueApp: !!app,
    有pinia: !!pinia,
    store列表: pinia ? [...pinia._s.keys()] : [],
    有playerStore: !!player,
    store字段: player ? Object.keys(player).length : 0,
    当前歌: player?.current?.name ?? null,
    播放中: player?.playing ?? null,
    已捕获音频元素: !!window.__pfAudio
  },
  null,
  1
)
