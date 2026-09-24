/**
 * 音源体检：逐个源实测，看谁真的能用。
 *
 * 判断标准（都是踩过坑总结的）：
 *   1. 能不能取到地址
 *   2. 地址是不是有效链接（曾经出现过 "None?from=xxx_api" 这种垃圾）
 *   3. 返回的是不是音频、体积像不像整首歌（试听片段体积会小得离谱）
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const sources = await window.api.source.list()
const ready = sources.filter((s) => s.status === 'ready' && s.enabled !== false)

/* 用一首确定存在的歌做基准 */
const res = await window.api.search.search({ keyword: '周杰伦 晴天', limit: 10 })
const all = res.platforms.flatMap((p) => p.songs)
const song = all.find((s) => s.platform === 'kw') ?? all[0]

const expectedSec = song.duration || 0
/** 320kbps 下整首歌大约的体积（字节） */
const expectedBytes = expectedSec > 0 ? (expectedSec * 320 * 1000) / 8 : 0

const rows = []

for (const src of ready) {
  const started = Date.now()
  let outcome = {
    音源: src.name,
    平台: (src.platforms ?? []).join('/'),
    结果: '',
    体积KB: null,
    估算时长: null,
    判定: ''
  }
  try {
    const r = await window.api.player.getUrl({
      song,
      quality: '320k',
      sourceIds: [src.id]
    })
    const url = String(r.url ?? '')
    outcome.结果 = '取流成功'

    // 地址形态
    if (!/^https?:\/\//i.test(url)) {
      outcome.判定 = '✗ 地址不是链接'
      rows.push(outcome)
      continue
    }

    // 探体积与类型（用应用自己的探测接口）
    const probe = await window.api.player.probe(url)
    if (probe?.size) {
      outcome.体积KB = Math.round(probe.size / 1024)
      // 320kbps 估算时长
      outcome.估算时长 = Math.round((probe.size * 8) / (320 * 1000))
    } else if (probe?.contentType) {
      outcome.结果 = `取流成功（无长度，类型 ${probe.contentType.slice(0, 20)}）`
    }

    if (expectedSec > 0 && outcome.估算时长 !== null) {
      const ratio = outcome.估算时长 / expectedSec
      outcome.判定 =
        ratio >= 0.75
          ? '✓ 完整'
          : ratio >= 0.2
            ? '⚠ 疑似片段'
            : '✗ 明显是片段'
    } else {
      outcome.判定 = '? 无法判断时长'
    }
  } catch (err) {
    outcome.结果 = '失败'
    outcome.判定 = `✗ ${String(err.message).slice(0, 60)}`
  }
  outcome.耗时ms = Date.now() - started
  rows.push(outcome)
}

const summary = {
  基准歌曲: `${song.name} - ${song.singer}（${expectedSec} 秒，320k 约 ${Math.round(expectedBytes / 1024)}KB）`,
  可用音源总数: ready.length,
  完整: rows.filter((r) => r.判定.startsWith('✓')).length,
  疑似片段: rows.filter((r) => r.判定.startsWith('⚠')).length,
  失败: rows.filter((r) => r.判定.startsWith('✗')).length
}

return JSON.stringify({ summary, rows }, null, 1)
