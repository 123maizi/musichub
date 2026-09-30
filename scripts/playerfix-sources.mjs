/**
 * 探针（player-fix）：音源就绪状态 + 直接测一次取流耗时。
 * 首次启动时音源脚本是后台装载的，第一首歌取流可能要等很久。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const sources = pinia._s.get('sources')

const res = await window.api.search.search({ keyword: '晴天', limit: 10 })
const songs = res.platforms.flatMap((p) => p.songs)
const song = songs.find((s) => s.duration >= 180 && s.duration <= 400 && s.platform !== 'local') ?? songs[0]

const started = Date.now()
let url = null
let err = null
try {
  url = await window.api.player.getUrl({ song, quality: '320k' })
} catch (e) {
  err = String(e?.message ?? e)
}

return JSON.stringify(
  {
    音源数: sources?.list?.length ?? sources?.sources?.length ?? '未知',
    音源键: sources ? Object.keys(sources).slice(0, 12) : null,
    搜索结果: res.platforms.map((p) => `${p.platform}:${p.songs.length}${p.error ? '(err)' : ''}`),
    选中: { 曲: song.name, 平台: song.platform, 时长: song.duration },
    取流耗时ms: Date.now() - started,
    取流成功: !!url,
    错误: err,
    源: url ? { id: url.sourceId, name: url.sourceName, quality: url.quality } : null
  },
  null,
  1
)
