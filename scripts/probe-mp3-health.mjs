/**
 * MP3 深度体检：不光看魔数，还要看 ID3 标签之后能不能对上一个合法的 MPEG 帧头。
 *
 * sniffAudioFormat 只认开头的 "ID3" 三个字节 —— 一个 ID3 标签写坏了、尺寸字段
 * 数值不对的文件照样能通过「是不是音频」的校验，但解码器找不到第一帧，就是播不了。
 */
import { readFileSync, openSync, readSync, closeSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const target = process.argv[2]
const files = []
if (target && target.toLowerCase().endsWith('.mp3')) {
  files.push(target)
} else {
  const dir = target || 'C:\\Users\\18509\\Desktop\\歌曲下载'
  for (const f of readdirSync(dir)) {
    if (f.toLowerCase().endsWith('.mp3')) files.push(join(dir, f))
  }
}

/** ID3v2 头里的尺寸是 syncsafe：每个字节只用低 7 位 */
function syncsafe(b) {
  return ((b[0] & 0x7f) << 21) | ((b[1] & 0x7f) << 14) | ((b[2] & 0x7f) << 7) | (b[3] & 0x7f)
}

const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0]
}
const SAMPLE_RATES = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000]
}

function findFrame(buf, from, limit = 200000) {
  for (let i = from; i < Math.min(buf.length - 4, from + limit); i += 1) {
    if (buf[i] !== 0xff) continue
    const b1 = buf[i + 1]
    if ((b1 & 0xe0) !== 0xe0) continue
    const verBits = (b1 >> 3) & 0x03
    const layerBits = (b1 >> 1) & 0x03
    if (verBits === 1 || layerBits === 0) continue
    const b2 = buf[i + 2]
    const srIdx = (b2 >> 2) & 0x03
    if (srIdx === 3) continue
    const brIdx = (b2 >> 4) & 0x0f
    if (brIdx === 0 || brIdx === 15) continue
    return { offset: i, verBits, layerBits, srIdx, brIdx }
  }
  return null
}

console.log(`检查 ${files.length} 个 mp3 文件\n`)

for (const f of files) {
  const name = f.split('\\').pop()
  const size = statSync(f).size
  const head = Buffer.alloc(Math.min(size, 512 * 1024))
  const fd = openSync(f, 'r')
  readSync(fd, head, 0, head.length, 0)
  closeSync(fd)

  const line = []
  line.push(`${name}`)
  line.push(`  体积 ${size} 字节`)

  let tagEnd = 0
  if (head.toString('ascii', 0, 3) === 'ID3') {
    const ver = `${head[3]}.${head[4]}`
    const flags = head[5]
    const tagSize = syncsafe(head.subarray(6, 10))
    tagEnd = 10 + tagSize
    line.push(`  ID3v2.${ver} 标签，声明大小 ${tagSize} 字节（含头共 ${tagEnd}），标志 0x${flags.toString(16)}`)
    if ((head[6] & 0x80) || (head[7] & 0x80) || (head[8] & 0x80) || (head[9] & 0x80)) {
      line.push(`  ✗ 尺寸字段不是 syncsafe 编码（高位被占用）—— 解码器会读到错误的位置`)
    }
    if (tagEnd >= size) {
      line.push(`  ✗ 标签声明的结束位置 ${tagEnd} 已经超出文件大小 ${size}`)
    } else {
      line.push(`  标签结束于 ${tagEnd}，其后第一个字节: 0x${head[tagEnd]?.toString(16)}`)
    }
  } else {
    line.push(`  没有 ID3v2 标签（裸 MP3）`)
  }

  const frame = findFrame(head, tagEnd)
  if (frame) {
    const verName = frame.verBits === 3 ? 'MPEG1' : frame.verBits === 2 ? 'MPEG2' : 'MPEG2.5'
    const layer = 4 - frame.layerBits
    const sr = SAMPLE_RATES[frame.verBits === 3 ? 3 : frame.verBits === 2 ? 2 : 0][frame.srIdx]
    const br = BITRATES[verName === 'MPEG1' ? 1 : 2][frame.brIdx]
    line.push(`  ✓ 找到合法帧头 @${frame.offset}（距标签末尾 ${frame.offset - tagEnd} 字节）`)
    line.push(`    ${verName} Layer${layer}  ${sr}Hz  ${br}kbps`)
    if (frame.offset !== tagEnd) {
      line.push(`    ⚠ 与标签末尾不重合 —— 中间有 ${frame.offset - tagEnd} 字节填充/垃圾`)
    }
  } else {
    line.push(`  ✗ 从标签末尾往后 200KB 内找不到任何合法 MPEG 帧头 —— 解码器无从下手`)
  }

  console.log(line.join('\n'))
  console.log('')
}
