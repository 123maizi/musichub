/**
 * 压缩后专项验证：5 平台搜索 + AI 翻译端到端（HTTP + JSON 解析路径）。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const store = (n) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)
const out = {}

/* ---------- 1. 五大平台逐个看：条数 + 平台级错误 ---------- */
const kw = '周杰伦'
const res = await window.api.search.search({ keyword: kw, limit: 30 })
out.search = {
  keyword: kw,
  cost: res.cost,
  platforms: (res.platforms ?? []).map((p) => ({
    platform: p.platform,
    name: p.providerName,
    songs: p.songs?.length ?? 0,
    error: p.error ? String(p.error).slice(0, 90) : null,
    sample: p.songs?.[0]?.name ?? null
  }))
}
out.search.platformsWithResults = out.search.platforms.filter((p) => p.songs > 0).length
out.search.totalSongs = out.search.platforms.reduce((s, p) => s + p.songs, 0)

/* ---------- 2. AI 翻译：真实 HTTP + JSON 解析 ---------- */
const cfg = await window.api.ai.getConfig()
out.ai = { configured: !!cfg?.apiKey || !!cfg?.apiKeyEnc, model: cfg?.model ?? null, target: cfg?.targetLang ?? null }

const lrc = [
  "[00:00.00]Imagine there's no heaven",
  '[00:05.00]It’s easy if you try',
  '[00:11.00]No hell below us',
  '[00:16.00]Above us only sky'
].join('\n')
const song = JSON.parse(JSON.stringify(store('search').visibleSongs[0] ?? { id: 'x', name: 'Imagine', singer: 'John Lennon' }))

const t0 = performance.now()
try {
  const r = await window.api.player.translateLyric(
    { lyric: lrc, tlyric: '', rlyric: '', lxlyric: '', sourceId: 'minify-verify' },
    'zh-CN',
    song
  )
  out.ai.translate = {
    ms: Math.round(performance.now() - t0),
    translated: r?.translated ?? null,
    lineCount: r?.lineCount ?? null,
    totalCount: r?.totalCount ?? null,
    sourceLang: r?.sourceLang ?? null,
    error: r?.error ? String(r.error).slice(0, 120) : null,
    translatedLyricSample: (r?.lyric?.tlyric ?? '').split('\n').filter(Boolean).slice(0, 3)
  }
} catch (err) {
  out.ai.translate = { error: String(err?.message ?? err).slice(0, 160) }
}

/* ---------- 3. 顺带确认渲染层仍是压缩产物 ---------- */
const scripts = [...document.querySelectorAll('script')].map((s) => s.getAttribute('src'))
out.renderer = {
  scripts,
  rowCount: document.querySelectorAll('.results .row').length,
  // 压缩产物的特征：函数名被压短（例如 useLibraryStore 之类的原名字串不会出现）
  minifiedHint: !/\buseLibraryStore\b/.test(document.documentElement.innerHTML)
}

await sleep(200)
return out
