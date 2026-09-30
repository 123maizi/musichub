/**
 * 两项硬验证：
 *
 * A. 绝不挂错图（历史事故：给「蜗牛 - 周杰伦」挂了天使童声合唱团的封面）
 *    判据：歌名对得上但歌手完全对不上的歌，必须返回 null —— 宁可占位。
 *
 * B. 失败结果不再被长期缓存（这是「有些封面死活加载不出来」的头号嫌疑）
 *    判据：同一个注定失败的 key，第 2 次调用应当命中负缓存（≈0ms），
 *          但过了 TTL 之后必须重新真的去请求（耗时恢复到几百毫秒）。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function song(name, singer) {
  return {
    id: 'probe_' + Math.random().toString(36).slice(2, 8),
    platform: 'kw',
    songmid: '0',
    name,
    singer,
    albumName: '',
    duration: 200,
    qualities: ['320k']
  }
}

async function timed(name, singer) {
  const t0 = performance.now()
  let url = null
  let err = null
  try {
    url = await window.api.player.resolveCover(song(name, singer))
  } catch (e) {
    err = String(e.message).slice(0, 80)
  }
  return { 结果: url, 耗时ms: Math.round(performance.now() - t0), err }
}

const out = {}

/* ------------------ A. 歌手对不上就必须拒绝 ------------------ */
out.A1_歌名对但歌手不存在_晴天 = await timed('晴天', '完全不存在歌手ZZZ')
out.A2_歌名歌手都不存在 = await timed('一个根本不存在的歌名XYZQW', '周杰伦')
out.A3_正常歌_晴天_周杰伦 = await timed('晴天', '周杰伦')

out.A_结论 = {
  歌手不符被拒: out.A1_歌名对但歌手不存在_晴天.结果 === null,
  空结果被拒: out.A2_歌名歌手都不存在.结果 === null,
  正常歌能补到: typeof out.A3_正常歌_晴天_周杰伦.结果 === 'string'
}

/* ------------------ B. 成功结果长期缓存 ------------------ */
out.B1_晴天_第二次 = await timed('晴天', '周杰伦')

/* ------------------ B. 失败结果只短缓存 ------------------ */
const KEY_NAME = '一个根本不存在的歌名XYZQW'
out.B2_失败_第一次 = await timed(KEY_NAME, '周杰伦')
out.B3_失败_紧接着第二次 = await timed(KEY_NAME, '周杰伦')

await sleep(25000)
out.B4_失败_等25秒后 = await timed(KEY_NAME, '周杰伦')

out.B_结论 = {
  失败被负缓存_第二次应接近0ms: out.B3_失败_紧接着第二次.耗时ms < 50,
  负缓存已过期_25秒后应重新请求: out.B4_失败_等25秒后.耗时ms > 200,
  成功结果长期缓存_第二次应接近0ms: out.B1_晴天_第二次.耗时ms < 50
}

return JSON.stringify(out, null, 1)
