/**
 * 主进程功能回归探针（task-3）
 *
 * 走的是渲染层真实 IPC 边界（window.api.*），也就是用户点界面时走的同一条路。
 * 覆盖任务书要求的回归清单：音源列表 / 搜索 / 播放 / 下载 / 歌词 / 翻译 / 收藏 / 歌单。
 *
 * 由 scripts/lifecycle-measure.mjs 通过 CDP 注入执行；末尾**故意让音乐继续播**，
 * 这样随后关闭窗口时，代理连接、音频流都处于活跃状态 —— 正是最容易留下
 * 悬挂 socket 的时刻。
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { steps: {}, ok: true }
const fail = (name, reason) => {
  out.steps[name] = { ok: false, reason }
  out.ok = false
}
const done = (name, data) => {
  out.steps[name] = { ok: true, ...data }
}

/* ---------- 1. 应用信息 & 音源列表 ---------- */
let info = null
let sources = []
try {
  info = await window.api.app.info()
  sources = await window.api.source.list()
  const ready = sources.filter((s) => s.status === 'ready')
  done('appInfo', { version: info.version, electron: info.electron, proxyPort: info.proxyPort })
  done('sourceList', {
    total: sources.length,
    ready: ready.length,
    platformsUnion: [...new Set(ready.flatMap((s) => s.platforms ?? []))].sort()
  })
  if (!info.proxyPort) fail('sourceList', '代理端口为 0，本地流代理没起来')
  if (ready.length === 0) fail('sourceList', '没有任何 ready 音源')
} catch (err) {
  fail('appInfo', String(err && err.message))
  fail('sourceList', String(err && err.message))
}

/* ---------- 2. 搜索（歌曲 / 艺人 / 专辑） ---------- */
let song = null
try {
  const res = await window.api.search.search({ keyword: '周杰伦', limit: 15 })
  const all = res.platforms.flatMap((p) => p.songs ?? [])
  const withError = res.platforms.filter((p) => p.error).map((p) => p.platform + ':' + p.error)
  done('searchSongs', {
    platforms: res.platforms.length,
    total: all.length,
    perPlatform: res.platforms.map((p) => `${p.platform}=${(p.songs ?? []).length}`),
    errors: withError
  })
  if (all.length === 0) fail('searchSongs', '五个平台加起来 0 条结果')
  song = all.find((s) => s.platform === 'tx') ?? all[0]
} catch (err) {
  fail('searchSongs', String(err && err.message))
}

try {
  const artists = await window.api.search.artists('周杰伦')
  const n = artists.platforms.reduce((a, p) => a + (p.artists?.length ?? 0), 0)
  done('searchArtists', { platforms: artists.platforms.length, total: n })
  if (n === 0) fail('searchArtists', '艺人搜索 0 条')
} catch (err) {
  fail('searchArtists', String(err && err.message))
}

try {
  const albums = await window.api.search.albums('周杰伦')
  const n = albums.platforms.reduce((a, p) => a + (p.albums?.length ?? 0), 0)
  done('searchAlbums', { platforms: albums.platforms.length, total: n })
  if (n === 0) fail('searchAlbums', '专辑搜索 0 条')
} catch (err) {
  fail('searchAlbums', String(err && err.message))
}

/* ---------- 3. 取流 + 真实播放 ---------- */
let resolvedUrl = null
if (song) {
  try {
    const plain = JSON.parse(JSON.stringify(song))
    const t0 = performance.now()
    const r = await window.api.player.getUrl({ song: plain, quality: '320k' })
    const cost = Math.round(performance.now() - t0)
    resolvedUrl = r.url
    done('getUrl', {
      song: plain.name + '「' + plain.singer + '」',
      source: r.sourceName,
      quality: r.quality,
      cached: r.cached ?? null,
      costMs: cost,
      urlIsProxy: /^http:\/\/127\.0\.0\.1:\d+\//.test(r.url ?? '')
    })
    if (!r.url) fail('getUrl', '没有拿到播放地址')
  } catch (err) {
    fail('getUrl', String(err && err.message))
  }
}

if (resolvedUrl) {
  try {
    const audio = new Audio()
    audio.volume = 0
    audio.src = resolvedUrl
    window.__probeAudio = audio // 留在全局，测量器随后要看到它还在播
    const meta = await new Promise((resolve) => {
      const t = setTimeout(() => resolve({ timeout: true }), 12000)
      audio.addEventListener(
        'loadedmetadata',
        () => {
          clearTimeout(t)
          resolve({ duration: audio.duration })
        },
        { once: true }
      )
      audio.addEventListener(
        'error',
        () => {
          clearTimeout(t)
          resolve({ error: audio.error?.code ?? -1 })
        },
        { once: true }
      )
    })
    await audio.play()
    const before = audio.currentTime
    await sleep(3000)
    const advanced = +(audio.currentTime - before).toFixed(2)
    done('playback', {
      duration: Number.isFinite(meta.duration) ? +meta.duration.toFixed(1) : String(meta.duration),
      advancedSeconds: advanced,
      paused: audio.paused,
      proxyUrlPort: new URL(resolvedUrl).port
    })
    if (!(advanced > 0.5)) fail('playback', `3 秒内进度只走了 ${advanced} 秒`)
  } catch (err) {
    fail('playback', String(err && err.message))
  }
}

/* ---------- 4. 歌词 + 翻译 ---------- */
if (song) {
  try {
    const lyric = await window.api.player.getLyric(JSON.parse(JSON.stringify(song)))
    const lines = (lyric?.lyric ?? '').split('\n').filter((l) => l.trim()).length
    done('lyric', { lines, hasTranslation: Boolean(lyric?.tlyric), source: lyric?.sourceId ?? null })
    if (lines === 0) fail('lyric', '歌词为空')
  } catch (err) {
    fail('lyric', String(err && err.message))
  }

  try {
    const src =
      "[00:00.00]Imagine there's no heaven\n[00:05.00]It's easy if you try\n[00:11.00]No hell below us"
    const tr = await window.api.player.translateLyric(
      { lyric: src, sourceId: 'lifecycle-probe' },
      'zh-CN'
    )
    done('translate', {
      translated: tr?.translated,
      lineCount: tr?.lineCount,
      totalCount: tr?.totalCount,
      provider: tr?.provider,
      sourceLang: tr?.sourceLang,
      error: tr?.error ?? null
    })
    // 翻译依赖公共接口/AI，网络不通不算功能坏掉，但要如实记下来
  } catch (err) {
    fail('translate', String(err && err.message))
  }
}

/* ---------- 5. 音乐库：收藏 / 历史 / 歌单 ---------- */
if (song) {
  try {
    const plain = JSON.parse(JSON.stringify(song))
    const before = await window.api.library.stats()
    await window.api.library.toggleFavorite(plain)
    const after = await window.api.library.stats()
    await window.api.library.toggleFavorite(plain)
    const restored = await window.api.library.stats()
    done('favorite', {
      before: before.favorites,
      afterToggle: after.favorites,
      afterUntoggle: restored.favorites
    })
    if (after.favorites !== before.favorites + 1) fail('favorite', '收藏没有 +1')
    if (restored.favorites !== before.favorites) fail('favorite', '取消收藏没有回到原值')
  } catch (err) {
    fail('favorite', String(err && err.message))
  }
}

try {
  const created = await window.api.library.playlist({ type: 'create', name: 'lifecycle-probe' })
  const pl = created.playlists.find((p) => p.name === 'lifecycle-probe')
  if (!pl) throw new Error('新建歌单没有出现在快照里')
  await window.api.library.playlist({
    type: 'addSongs',
    id: pl.id,
    songs: [JSON.parse(JSON.stringify(song))]
  })
  const added = await window.api.library.playlist({ type: 'clear', id: pl.id })
  const cleared = added.playlists.find((p) => p.id === pl.id)
  const removed = await window.api.library.playlist({ type: 'remove', id: pl.id })
  done('playlist', {
    created: Boolean(pl),
    songsAfterClear: cleared?.songs.length ?? null,
    stillThere: removed.playlists.some((p) => p.id === pl.id)
  })
  if (cleared?.songs.length !== 0) fail('playlist', '清空歌单没生效')
  if (removed.playlists.some((p) => p.id === pl.id)) fail('playlist', '删除歌单没生效')
} catch (err) {
  fail('playlist', String(err && err.message))
}

/* ---------- 6. 下载：配置 + 真下一个 + 移除 ---------- */
try {
  const cfg = await window.api.download.setConfig({
    dir: 'F:\\MusicHub\\.tmp-lifecycle\\downloads',
    writeTag: false,
    downloadCover: false,
    downloadLyric: false
  })
  const tasks = await window.api.download.add({
    songs: [JSON.parse(JSON.stringify(song))],
    quality: '320k'
  })
  const id = tasks[0].id
  let final = null
  for (let i = 0; i < 60; i += 1) {
    await sleep(1000)
    const list = await window.api.download.list()
    final = list.find((t) => t.id === id)
    if (final && (final.status === 'done' || final.status === 'error')) break
  }
  const audit = await window.api.download.audit()
  done('download', {
    dir: cfg.dir,
    status: final?.status,
    progress: final?.progress,
    received: final?.received,
    file: final?.fileName,
    sourceName: final?.sourceName,
    actualQuality: final?.actualQuality,
    audit: audit[id] ?? null
  })
  if (final?.status !== 'done') fail('download', `下载没有完成，最终状态 ${final?.status}: ${final?.error ?? ''}`)
  // 收尾：删任务 + 删文件，别把测试文件留在磁盘上
  await window.api.download.remove([id], true)
} catch (err) {
  fail('download', String(err && err.message))
}

/* ---------- 7. 封面 ---------- */
if (song) {
  try {
    const cover = await window.api.player.resolveCover(JSON.parse(JSON.stringify(song)))
    done('cover', { resolved: Boolean(cover), sample: cover ? String(cover).slice(0, 80) : null })
  } catch (err) {
    fail('cover', String(err && err.message))
  }
}

/* ---------- 8. 事件订阅通道仍在 ---------- */
done('eventChannels', { channels: Object.keys(window.api.events ?? {}) })

/* ---------- 汇总 ---------- */
out.failedSteps = Object.entries(out.steps)
  .filter(([, v]) => v.ok === false)
  .map(([k]) => k)
out.playingAtExit = Boolean(window.__probeAudio && !window.__probeAudio.paused)
return out
