/** 正在播放页 + 歌词状态诊断（给 Lead 判断「歌词 0 行」是产品问题还是用例问题） */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)

window.location.hash = '#/now-playing'
await sleep(3500)
const player = store('player')
const texts = $$('.lyric-line, .lyric li, .lrc-line, [class*="lyric"] [class*="line"]')
return {
  hash: location.hash,
  pageRendered: !!$('.view, section'),
  currentSong: player.current ? { name: player.current.name, platform: player.current.platform, id: player.current.id } : null,
  playing: player.playing,
  lyricLineCount: player.lyricLines?.length ?? null,
  lyricDomLines: texts.length,
  lyricDomLinesWithText: texts.filter((el) => (el.innerText || '').trim()).length,
  firstDomLine: texts[0]?.innerText?.slice(0, 40) ?? null,
  hasTranslateButton: $$('button').some((b) => /翻译/.test(b.innerText)),
  hasSaveCoverButton: $$('button').some((b) => /存封面/.test(b.innerText)),
  bodyHasNoLyricHint: document.body.innerText.includes('暂无歌词') || document.body.innerText.includes('没有歌词'),
  playerError: player.error ?? null,
  lyricState: typeof player.lyric === 'object' && player.lyric ? Object.keys(player.lyric) : player.lyric ?? null,
  nowPlayingText: (document.querySelector('.view')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 200)
}
