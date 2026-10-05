/**
 * 音源审计：逐个提取平台声明与实际请求域名，自动标出视频站。
 * 只读，不改任何文件。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIR = process.argv[2]

/** 纯音乐平台域名（放行） */
const MUSIC = [
  'kuwo.cn', 'kugou.com', 'y.qq.com', 'c.y.qq.com', 'u.y.qq.com', 'music.163.com',
  'migu.cn', 'music.migu.cn', '12530.com', 'music.taihe.com', 'qqmusic.qq.com',
  'm.kugou.com', 'm.kuwo.cn', 'mobilecdn.kugou.com', 'krcs.kugou.com', 'lyrics.kugou.com',
  'music.163.com', 'interface.music.163.com', 'bodianmusic.com', '5nd.com', '51sjyx.com'
]

/** 视频 / 短视频 / 非音乐内容平台（一律拒绝） */
const VIDEO = [
  'bilibili', 'b23.tv', 'hdslb', 'youtube', 'youtu.be', 'googlevideo',
  'douyin', 'kuaishou', 'ixigua', 'weibo', 'acfun', 'mgtv', 'iqiyi', 'youku',
  'tiktok', 'twitter', 'ximalaya', 'qingting', 'lizhi', 'huya', 'douyu',
  'zhihu', 'xiaohongshu', 'pipix', 'pearvideo', 'miaopai', 'sohu', 'le.com', 'pptv'
]

const files = readdirSync(DIR).filter((f) => f.endsWith('.js'))
const rows = []

for (const f of files) {
  const full = join(DIR, f)
  const text = readFileSync(full, 'utf8')
  const size = statSync(full).size

  // 1) 平台声明：洛雪协议里 sources 的键（各脚本格式不一，按 `kw: {` 这种键匹配最稳）
  const platforms = new Set()
  for (const m of text.matchAll(/\b(kw|kg|tx|wy|mg)\s*:\s*\{/g)) platforms.add(m[1])
  for (const m of text.matchAll(/['"](kw|kg|tx|wy|mg)['"]\s*:/g)) platforms.add(m[1])

  // 2) 支持的动作
  const actions = []
  if (/musicUrl/.test(text)) actions.push('取流')
  if (/\blyric\b/.test(text)) actions.push('歌词')
  if (/\bpic\b/.test(text)) actions.push('封面')

  // 3) 音质档位
  const qualities = new Set()
  for (const m of text.matchAll(/\b(128k|192k|320k|flac|flac24bit|hires|atmos|master)\b/gi)) {
    qualities.add(m[1].toLowerCase())
  }

  // 4) 混淆特征：无可读域名 + 大体积 + 大量十六进制/unicode 转义
  const escSeq = (text.match(/\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/gi) ?? []).length
  const obfuscated = escSeq > 500

  // 5) 所有域名
  const domains = new Set()
  for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) domains.add(m[1].toLowerCase())

  const domainList = [...domains]
  const videoHit = domainList.filter((d) => VIDEO.some((v) => d.includes(v)))
  const musicHit = domainList.filter((d) => MUSIC.some((v) => d.includes(v)))
  const otherHit = domainList.filter((d) => !videoHit.includes(d) && !musicHit.includes(d))

  rows.push({
    文件: f,
    'KB': Math.round(size / 1024),
    平台: [...platforms].join('/') || '未声明',
    动作: actions.join('+') || '无',
    音质: [...qualities].join('/') || '未声明',
    视频站: videoHit.length ? '★ ' + videoHit.join(', ') : '无',
    混淆: obfuscated ? '★ 是（' + escSeq + ' 个转义）' : '否',
    域名数: domainList.length,
    未分类域名: otherHit.slice(0, 6).join(', ') || '无'
  })
}

console.log(JSON.stringify({ 总数: files.length, 明细: rows }, null, 1))
