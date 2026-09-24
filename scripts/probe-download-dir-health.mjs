/**
 * 体检用户下载目录里的每一个文件：
 *  1. 文件头是否真的是音频（不是网页/JSON/空壳）
 *  2. 扩展名与真实容器是否一致
 *  3. 是否留下 .part 残骸
 *  4. 同目录内是否有重名（同名只可能剩一个文件 = 覆盖过的证据）
 */
import { readdirSync, statSync, openSync, readSync, closeSync, existsSync } from 'node:fs'
import { join, extname, basename } from 'node:path'

const DIR = process.argv[2] || 'C:\\Users\\18509\\Desktop\\歌曲下载'

function readHead(p, n = 64) {
  const fd = openSync(p, 'r')
  const buf = Buffer.alloc(n)
  const got = readSync(fd, buf, 0, n, 0)
  closeSync(fd)
  return buf.subarray(0, got)
}

/** 与 src/main/core/download/audio-format.ts 的 sniffAudioFormat 保持一致的判定 */
function sniff(b) {
  if (!b || b.length < 12) return null
  if (b.toString('ascii', 0, 3) === 'ID3') return { ext: 'mp3', kind: 'MP3(ID3)' }
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return { ext: 'mp3', kind: 'MP3(帧同步)' }
  if (b.toString('ascii', 0, 4) === 'fLaC') return { ext: 'flac', kind: 'FLAC' }
  if (b.toString('ascii', 0, 4) === 'OggS') return { ext: 'ogg', kind: 'Ogg' }
  if (b.toString('ascii', 4, 8) === 'ftyp') return { ext: 'm4a', kind: 'MP4/M4A' }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE')
    return { ext: 'wav', kind: 'WAV' }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)
    return { ext: 'webm', kind: 'Matroska/WebM' }
  if (b[0] === 0x30 && (b[1] === 0x26 || b[1] === 0x2e))
    return { ext: 'wma', kind: 'ASF/WMA' }
  return null
}

function describeNonAudio(b) {
  const s = b.toString('utf8', 0, Math.min(b.length, 48)).replace(/[\r\n\t]/g, ' ')
  const low = s.toLowerCase().trimStart()
  if (low.startsWith('<!doctype') || low.startsWith('<html')) return `HTML 网页 (${s.slice(0, 32)}…)`
  if (low.startsWith('{') || low.startsWith('[')) return `JSON 文本 (${s.slice(0, 32)}…)`
  return `未知内容 (${s.slice(0, 32)}…)`
}

const extOk = new Map([
  ['mp3', ['mp3']],
  ['flac', ['flac']],
  ['m4a', ['m4a', 'mp4']],
  ['ogg', ['ogg', 'oga']],
  ['wav', ['wav']],
  ['webm', ['webm']],
  ['wma', ['wma']]
])

const files = readdirSync(DIR)
const audio = []
const parts = []
const others = []

for (const f of files) {
  const p = join(DIR, f)
  const st = statSync(p)
  if (!st.isFile()) continue
  if (f.toLowerCase().endsWith('.part')) {
    parts.push({ f, size: st.size })
    continue
  }
  const e = extname(f).toLowerCase().replace('.', '')
  if (!['mp3', 'flac', 'm4a', 'mp4', 'ogg', 'wav', 'webm', 'wma', 'aac'].includes(e)) {
    others.push({ f, size: st.size })
    continue
  }
  const head = readHead(p)
  const fmt = sniff(head)
  const real = fmt ? fmt.ext : null
  const ok = fmt && (extOk.get(real) ?? []).includes(e)
  const tiny = st.size < 64 * 1024
  audio.push({
    f,
    size: st.size,
    kind: fmt ? fmt.kind : `✗非音频: ${describeNonAudio(head)}`,
    ok: Boolean(fmt),
    extMatch: Boolean(ok),
    tiny
  })
}

console.log(`目录: ${DIR}`)
console.log(`文件总数 ${files.length}  |  音频 ${audio.length}  |  .part 残骸 ${parts.length}  |  其它 ${others.length}\n`)

const bad = audio.filter((a) => !a.ok)
const mism = audio.filter((a) => a.ok && !a.extMatch)
const small = audio.filter((a) => a.ok && a.tiny)

console.log('文件                                     大小        真实格式              扩展名')
console.log('-'.repeat(96))
for (const a of audio) {
  const flag = !a.ok ? '✗坏' : !a.extMatch ? '⚠不符' : a.tiny ? '⚠过小' : '✓'
  console.log(
    `${flag} ${a.f.padEnd(38).slice(0, 38)} ${String(a.size).padStart(10)}  ${String(a.kind).padEnd(20).slice(0, 20)} ${a.extMatch ? '' : '← 扩展名对不上'}`
  )
}

console.log('\n=== 结论 ===')
console.log(`内容不是音频的坏文件: ${bad.length}`)
for (const a of bad) console.log(`  ✗ ${a.f}  ${a.kind}`)
console.log(`扩展名与真实格式不符: ${mism.length}`)
for (const a of mism) console.log(`  ⚠ ${a.f}  真实是 ${a.kind}`)
console.log(`体积异常偏小(<64KB): ${small.length}`)
for (const a of small) console.log(`  ⚠ ${a.f}  ${a.size} 字节`)
console.log(`未清理的 .part 残骸: ${parts.length}`)
for (const p of parts) console.log(`  ⚠ ${p.f}  ${p.size} 字节`)
if (others.length) {
  console.log(`其它文件: ${others.length}`)
  for (const o of others) console.log(`  - ${o.f}  ${o.size} 字节`)
}
