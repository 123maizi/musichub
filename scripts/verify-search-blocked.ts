/**
 * 搜索层「平台返回网页」处理的单元验证。
 *
 * 背景：平台被限流时不会返回错误码，而是返回一个 HTML 页面（200 + text/html）。
 *     旧代码有两种坏结果 —— 要么抛 "Unexpected token '<'" 这种看不懂的错，
 *     要么被 asObj() 静默吞掉变成「这个平台搜不到歌」。
 *     这个测试确认现在会给出带平台名的、人能看懂的错误。
 *
 * 做法：把 globalThis.fetch 打桩成返回 HTML，然后调用真实的 provider。
 */
import { builtinProviders } from '../src/main/core/search/builtin'

const htmlPage =
  '<!DOCTYPE html><html><head><title>403</title></head><body><h1>访问受限</h1></body></html>'

const realFetch = globalThis.fetch

function stubHtml(): void {
  globalThis.fetch = (async () =>
    new Response(htmlPage, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })) as typeof fetch
}

const cases = [
  { id: 'kw', name: '酷我音乐' },
  { id: 'kg', name: '酷狗音乐' },
  { id: 'tx', name: 'QQ音乐' },
  { id: 'wy', name: '网易云音乐' },
  { id: 'mg', name: '咪咕音乐' }
]

let pass = 0
let fail = 0

for (const c of cases) {
  const provider = builtinProviders.find((p) => p.id === c.id)
  if (!provider) {
    console.log(`✗ 找不到 provider ${c.id}`)
    fail += 1
    continue
  }

  stubHtml()
  let message = ''
  try {
    await provider.search('周杰伦', 1, 20)
    message = '(没有抛错 —— 会被静默当成空结果)'
  } catch (err) {
    message = err instanceof Error ? err.message : String(err)
  } finally {
    globalThis.fetch = realFetch
  }

  const friendly = message.includes('返回了网页') && message.includes('限流')
  const cryptic = /Unexpected token|JSON|<!DOCTYPE|<html/i.test(message)
  const silent = message.includes('没有抛错')

  if (friendly && !silent) {
    console.log(`✓ ${c.name}  →  ${message}`)
    pass += 1
  } else {
    console.log(`✗ ${c.name}  →  ${message}`)
    if (cryptic) console.log('     仍是不友好的解析错误')
    if (silent) console.log('     仍是静默返回空结果')
    fail += 1
  }
}

/* ---- 反向验证：正常返回时不能被误伤 ---- */
const okJson = JSON.stringify({
  abslist: [
    {
      SONGNAME: '测试歌曲',
      ARTIST: '测试歌手',
      ALBUM: '测试专辑',
      DC_TARGETID: '12345',
      DURATION: '240'
    }
  ],
  TOTAL: '1'
})
globalThis.fetch = (async () =>
  new Response(okJson, {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })) as typeof fetch
try {
  const kw = builtinProviders.find((p) => p.id === 'kw')!
  const res = await kw.search('测试', 1, 20)
  if (res.songs.length === 1 && res.songs[0].name === '测试歌曲') {
    console.log(`✓ 正常 JSON 未被误伤，解析出 ${res.songs.length} 条：${res.songs[0].name}`)
    pass += 1
  } else {
    console.log(`✗ 正常 JSON 解析异常：${JSON.stringify(res.songs).slice(0, 200)}`)
    fail += 1
  }
} catch (err) {
  console.log(`✗ 正常 JSON 竟被拦下：${err instanceof Error ? err.message : err}`)
  fail += 1
} finally {
  globalThis.fetch = realFetch
}

console.log('')
console.log(`结果：通过 ${pass}，失败 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
