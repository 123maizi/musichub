/**
 * FLAC 元数据结构体检。
 *
 * 为什么单独查 FLAC：我们的 writeFlacTags 是手写代码，把元数据块拆开重排。
 * Chromium 解码很宽容（能播不代表结构合规），而严格的播放器会把
 * 结构错误直接报成「文件损坏」。
 *
 * 要检查的点（FLAC 规范的硬性要求）：
 *   1. 文件必须以 fLaC 开头
 *   2. 第一个块必须是 STREAMINFO(0)
 *   3. 有且仅有一个块带 last-block 标志，且必须是最后一个块
 *   4. 每个块的长度字段要和实际数据长度一致
 *   5. VORBIS_COMMENT 的条目长度必须是 UTF-8 字节数（不是字符数）
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'C:\\Users\\18509\\Desktop\\歌曲下载'
const BLOCK_NAMES = {
  0: 'STREAMINFO',
  1: 'PADDING',
  2: 'APPLICATION',
  3: 'SEEKTABLE',
  4: 'VORBIS_COMMENT',
  5: 'CUESHEET',
  6: 'PICTURE'
}

const files = readdirSync(dir).filter((f) => /\.flac$/i.test(f))
console.log(`\n检查 ${files.length} 个 FLAC`)
console.log('='.repeat(78))

for (const name of files) {
  const buf = readFileSync(join(dir, name))
  console.log(`\n${name.length > 55 ? name.slice(0, 55) + '…' : name}`)
  console.log(`  大小 ${(buf.length / 1024 / 1024).toFixed(2)} MB`)

  if (buf.toString('latin1', 0, 4) !== 'fLaC') {
    console.log('  ✗ 开头不是 fLaC —— 不是有效 FLAC')
    continue
  }
  console.log('  魔数 fLaC ✓')

  let pos = 4
  let index = 0
  let lastSeen = false
  let streamInfoFirst = false
  let audioStart = -1

  for (;;) {
    if (pos + 4 > buf.length) {
      console.log('  ✗ 读到文件尾都没遇到结束块')
      break
    }
    const headerByte = buf[pos]
    const last = (headerByte & 0x80) !== 0
    const type = headerByte & 0x7f
    const len = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3]

    const inRange = pos + 4 + len <= buf.length
    const label = BLOCK_NAMES[type] ?? `未知(${type})`
    console.log(
      `  块#${index} ${label.padEnd(15)} 长度=${String(len).padStart(9)} last=${last ? '是' : '否'}${inRange ? '' : '  ✗ 超出文件范围'}`
    )

    if (index === 0 && type === 0) streamInfoFirst = true
    if (last) lastSeen = true

    // 看看 VORBIS_COMMENT 里到底写了什么
    if (type === 4 && inRange) {
      const body = buf.subarray(pos + 4, pos + 4 + len)
      let p = 0
      const vendorLen = body.readUInt32LE(p); p += 4
      const vendor = body.toString('utf8', p, p + vendorLen); p += vendorLen
      const count = body.readUInt32LE(p); p += 4
      console.log(`        厂商标记="${vendor}" 条目数=${count}`)
      for (let i = 0; i < count && p + 4 <= body.length; i += 1) {
        const elen = body.readUInt32LE(p); p += 4
        if (p + elen > body.length) {
          console.log(`        ✗ 第 ${i + 1} 条声明长度 ${elen} 超出块范围`)
          break
        }
        const text = body.toString('utf8', p, p + elen); p += elen
        // 校验：长度字段应当等于 UTF-8 字节数
        const recomputed = Buffer.byteLength(text, 'utf8')
        const ok = recomputed === elen
        console.log(`        ${text}${ok ? '' : `   ✗ 长度字段=${elen} 实际字节=${recomputed}`}`)
      }
      if (p !== body.length) console.log(`        ⚠ 解析完还剩 ${body.length - p} 字节未用`)
    }

    if (type === 6 && inRange) {
      const body = buf.subarray(pos + 4, pos + 4 + len)
      const picType = body.readUInt32BE(0)
      const mimeLen = body.readUInt32BE(4)
      const mime = body.toString('ascii', 8, 8 + mimeLen)
      let q = 8 + mimeLen
      const descLen = body.readUInt32BE(q); q += 4 + descLen
      const w = body.readUInt32BE(q)
      const h = body.readUInt32BE(q + 4)
      const dataLen = body.readUInt32BE(q + 12)
      const dataStart = q + 16
      const magic = body.subarray(dataStart, dataStart + 4)
      const isJpg = magic[0] === 0xff && magic[1] === 0xd8
      const isPng = magic[0] === 0x89 && magic[1] === 0x50
      console.log(`        类型=${picType} MIME="${mime}" ${w}x${h} 数据=${Math.round(dataLen / 1024)}KB ${isJpg ? 'JPEG ✓' : isPng ? 'PNG ✓' : '⚠ 不是图片'}`)
      if (dataStart + dataLen !== body.length) {
        console.log(`        ✗ 图片数据长度对不上：声明 ${dataLen}，实际 ${body.length - dataStart}`)
      }
    }

    pos += 4 + len
    index += 1
    if (last) {
      audioStart = pos
      break
    }
    if (index > 40) {
      console.log('  ⚠ 块太多，疑似结构异常，停止解析')
      break
    }
  }

  console.log(`  STREAMINFO 在首位: ${streamInfoFirst ? '✓' : '✗ 违反 FLAC 规范！'}`)
  console.log(`  有 last 块: ${lastSeen ? '✓' : '✗'}`)
  if (audioStart > 0) {
    const frameSync = buf[audioStart] === 0xff && (buf[audioStart + 1] & 0xfc) === 0xf8
    console.log(`  音频从 ${audioStart} 开始，帧同步字: ${frameSync ? '✓' : `✗ (0x${buf[audioStart].toString(16)})`}`)
  }
}

console.log(`\n${'='.repeat(78)}`)
