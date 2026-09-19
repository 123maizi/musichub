/**
 * 体检已下载的音频文件。
 *
 * 只做一件事：看文件头和实际内容对不对得上。
 * 「下载了却播不了」绝大多数是三种原因之一：
 *   1. 扩展名和真实格式不符（比如 FLAC 存成了 .mp3）
 *   2. 文件被写标签写坏了
 *   3. 下下来的根本不是音频（错误页、JSON）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const dir = process.argv[2] ?? 'C:\\Users\\18509\\Desktop\\歌曲下载'

/** 按文件头判断真实格式 */
function sniff(buf) {
  if (buf.length < 12) return { fmt: '太短，不是有效文件', detail: '' }
  const ascii = (o, n) => buf.toString('latin1', o, o + n)

  if (ascii(0, 3) === 'ID3') {
    const size =
      ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)
    // ID3 之后第一帧同步字在哪，能看出标签长度是否合理
    return { fmt: 'MP3 (ID3v2)', detail: `ID3 头声明标签长度 ${size} 字节` }
  }
  if (ascii(0, 4) === 'fLaC') return { fmt: 'FLAC', detail: '原生 FLAC 流' }
  if (ascii(0, 4) === 'RIFF') return { fmt: 'WAV', detail: '' }
  if (ascii(0, 4) === 'OggS') return { fmt: 'OGG', detail: '' }
  if (ascii(4, 4) === 'ftyp') return { fmt: 'M4A/MP4', detail: ascii(8, 4) }
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return { fmt: 'MP3 (裸帧，无标签)', detail: '' }
  if (ascii(0, 5) === '<?xml' || ascii(0, 2) === '<h') return { fmt: '⚠ HTML 页面', detail: '' }
  if (ascii(0, 1) === '{') return { fmt: '⚠ JSON', detail: '' }
  return { fmt: '未知', detail: `头部字节 ${buf.toString('hex', 0, 12)}` }
}

/** MP3 里第一帧的位置：ID3 标签之后应当紧跟 0xFFEx 同步字 */
function mp3FirstFrame(buf) {
  if (buf.toString('latin1', 0, 3) !== 'ID3') {
    return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 ? 0 : -1
  }
  const size =
    ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)
  return 10 + size
}

const files = readdirSync(dir).filter((f) => /\.(mp3|flac|m4a|wav|ogg|ape|wma)$/i.test(f))
if (files.length === 0) {
  console.log(`${dir} 下没有音频文件`)
  process.exit(0)
}

console.log(`\n体检目录：${dir}`)
console.log('='.repeat(78))

for (const f of files) {
  const path = join(dir, f)
  const size = statSync(path).size
  const buf = readFileSync(path)
  const ext = extname(f).slice(1).toLowerCase()
  const { fmt, detail } = sniff(buf)

  const expected = ext === 'mp3' ? 'MP3' : ext === 'flac' ? 'FLAC' : ext.toUpperCase()
  const match = fmt.startsWith(expected) || (expected === 'MP3' && fmt.startsWith('MP3'))

  console.log(`\n${f}`)
  console.log(`    大小 ${(size / 1024 / 1024).toFixed(2)} MB`)
  console.log(`    扩展名 .${ext}   真实格式 ${fmt} ${detail}`)
  console.log(`    格式一致: ${match ? '✓' : '✗ 不一致！'}`)

  if (ext === 'mp3' && fmt.startsWith('MP3')) {
    const frameAt = mp3FirstFrame(buf)
    const ok = buf[frameAt] === 0xff && (buf[frameAt + 1] & 0xe0) === 0xe0
    console.log(`    首个音频帧位置 ${frameAt}，帧同步字: ${ok ? '✓' : '✗ 不是有效帧'}`)
    if (!ok) {
      console.log(`        该处字节: ${buf.toString('hex', frameAt, frameAt + 8)}`)
    }
  }
}

console.log(`\n${'='.repeat(78)}`)
console.log('说明：FFmpeg 更权威，但这里只做「文件头与内容是否自洽」的快速判断')
