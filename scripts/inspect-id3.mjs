/**
 * 拆解下载文件的 ID3v2 标签，逐帧检查。
 *
 * 目的：文件本身能解码（Chromium 实测全部通过），但用户的播放器说「损坏」——
 * 那问题多半在标签的字节结构上。严格一点的播放器遇到不合规的帧
 * 会直接判定整个文件有问题。
 *
 * 重点看三件事：
 *   1. 帧大小格式对不对（v2.3 是普通 32 位大端，v2.4 才是 synchsafe）
 *   2. 文本帧的编码字节与 BOM 是否自洽
 *   3. 封面帧里嵌的到底是不是一张真图片（拿首字节对指纹）
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'C:\\Users\\18509\\Desktop\\歌曲下载'

function readSynchsafe(buf, offset) {
  return (
    ((buf[offset] & 0x7f) << 21) |
    ((buf[offset + 1] & 0x7f) << 14) |
    ((buf[offset + 2] & 0x7f) << 7) |
    (buf[offset + 3] & 0x7f)
  )
}

function imageMagic(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'JPEG ✓'
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'PNG ✓'
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF') return 'WEBP ✓'
  if (buf.length > 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'GIF ✓'
  // 不是图片 —— 很可能是抓封面时拿到了一段错误页
  const head = buf.toString('latin1', 0, 24).replace(/[^\x20-\x7e]/g, '.')
  return `⚠ 不是图片！开头是: ${head}`
}

const files = readdirSync(dir).filter((f) => /\.mp3$/i.test(f))
console.log(`\n检查 ${files.length} 个 MP3 的 ID3 标签`)
console.log('='.repeat(78))

for (const name of files) {
  const buf = readFileSync(join(dir, name))
  console.log(`\n${name.length > 50 ? name.slice(0, 50) + '…' : name}`)

  if (buf.toString('latin1', 0, 3) !== 'ID3') {
    console.log('  没有 ID3v2 标签（裸 MP3 帧）—— 正规播放器都能播，只是没有歌名封面')
    continue
  }

  const major = buf[3]
  const minor = buf[4]
  const flags = buf[5]
  const tagSize = readSynchsafe(buf, 6)

  console.log(`  ID3v2.${major}.${minor}  flags=0x${flags.toString(16).padStart(2, '0')}  标签长度=${tagSize}`)
  if (major !== 3) console.log(`  ⚠ 版本不是 2.3，帧大小可能是 synchsafe 格式，我按 2.3 解析会错位`)

  let pos = 10
  const end = 10 + tagSize
  let frameCount = 0

  while (pos + 10 <= end && pos + 10 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) {
      console.log(`  ⚠ 位置 ${pos} 处的帧 ID 不合法: "${id.replace(/[^\x20-\x7e]/g, '.')}" —— 标签结构在这里断了`)
      break
    }

    // v2.3 帧大小是普通 32 位大端；v2.4 是 synchsafe
    const size = major >= 4 ? readSynchsafe(buf, pos + 4) : buf.readUInt32BE(pos + 4)
    const fflags = buf.readUInt16BE(pos + 8)
    frameCount += 1

    if (pos + 10 + size > buf.length) {
      console.log(`  ⚠ 帧 ${id} 声明长度 ${size}，超出了文件范围 —— 文件被截短了？`)
      break
    }

    const body = buf.subarray(pos + 10, pos + 10 + size)
    let detail = ''

    if (id.startsWith('T') && id !== 'TXXX') {
      const enc = body[0]
      const hasBom = body.length > 2 && body[1] === 0xff && body[2] === 0xfe
      const text = enc === 1 ? body.subarray(3).toString('utf16le') : body.subarray(1).toString('latin1')
      detail = `编码=${enc} BOM=${hasBom ? '有' : '无'} 内容="${text.slice(0, 40)}"`
      if (enc === 1 && !hasBom) detail += '  ⚠ UTF-16 却缺 BOM，严格播放器会乱码或报错'
    } else if (id === 'APIC') {
      // 编码(1) + MIME(0结尾) + 图片类型(1) + 描述(0结尾) + 图片数据
      let p = 0
      const enc = body[p]; p += 1
      const mimeEnd = body.indexOf(0, p)
      const mime = body.toString('latin1', p, mimeEnd === -1 ? p + 20 : mimeEnd)
      p = (mimeEnd === -1 ? p + 20 : mimeEnd) + 1
      const picType = body[p]; p += 1
      const descEnd = body.indexOf(0, p)
      p = (descEnd === -1 ? p : descEnd) + 1
      const img = body.subarray(p)
      detail = `编码=${enc} MIME="${mime}" 类型=${picType} 图片=${Math.round(img.length / 1024)}KB → ${imageMagic(img)}`
    } else if (id === 'COMM') {
      detail = `长度=${size}`
    } else {
      detail = `长度=${size}`
    }

    console.log(`  帧 ${id}  size=${size} flags=0x${fflags.toString(16).padStart(4, '0')}  ${detail}`)
    pos += 10 + size
  }

  console.log(`  共 ${frameCount} 帧；标签结束于 ${pos}，音频从 ${pos} 开始`)
  const sync = buf[pos] === 0xff && (buf[pos + 1] & 0xe0) === 0xe0
  console.log(`  音频首帧同步字: ${sync ? '✓' : '✗'}`)
}

console.log(`\n${'='.repeat(78)}`)
