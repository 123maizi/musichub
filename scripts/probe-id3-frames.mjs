/**
 * ID3v2 帧级校验。
 *
 * 前面只验了标签头（syncsafe 尺寸 + 是否对得上帧头）。但严格一点的播放器
 * 会逐个解析帧：帧 ID、帧大小（v2.3 是普通 32 位大端，v2.4 才是 syncsafe）、
 * 标志位、以及 APIC 封面帧的内部结构。任何一处不对，有些播放器就直接拒播。
 */
import { openSync, readSync, closeSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] || 'C:\\Users\\18509\\Desktop\\歌曲下载'
const only = process.argv[3]

const files = readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith('.mp3'))
  .filter((f) => !only || f.includes(only))
  .map((f) => join(dir, f))

const syncsafe = (b) => ((b[0] & 0x7f) << 21) | ((b[1] & 0x7f) << 14) | ((b[2] & 0x7f) << 7) | (b[3] & 0x7f)
const u32 = (b) => ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0

for (const f of files) {
  const name = f.split('\\').pop()
  const size = statSync(f).size
  const fd = openSync(f, 'r')
  const buf = Buffer.alloc(Math.min(size, 4 * 1024 * 1024))
  readSync(fd, buf, 0, buf.length, 0)
  closeSync(fd)

  console.log(`── ${name}`)
  if (buf.toString('ascii', 0, 3) !== 'ID3') {
    console.log(`   没有 ID3v2 标签\n`)
    continue
  }
  const major = buf[3]
  const tagSize = syncsafe(buf.subarray(6, 10))
  const end = 10 + tagSize
  console.log(`   ID3v2.${major}.${buf[4]}  标签数据 ${tagSize} 字节  结束于 ${end}`)

  let p = 10
  const frames = []
  let problems = 0
  while (p + 10 <= end) {
    const id = buf.toString('ascii', p, p + 4)
    if (id === '\u0000\u0000\u0000\u0000' || /^\0+$/.test(id)) break
    if (!/^[A-Z0-9]{4}$/.test(id)) {
      console.log(`   ✗ @${p} 帧 ID 非法: ${JSON.stringify(id)}`)
      problems += 1
      break
    }
    const fsize = major === 4 ? syncsafe(buf.subarray(p + 4, p + 8)) : u32(buf.subarray(p + 4, p + 8))
    const flags = buf[p + 8] * 256 + buf[p + 9]
    const frameEnd = p + 10 + fsize
    let bad = ''
    if (frameEnd > end) bad = `帧越过标签末尾（需要 ${frameEnd}，标签止于 ${end}）`
    frames.push({ id, size: fsize, flags, at: p, bad })
    if (bad) problems += 1
    p = frameEnd
    if (frames.length > 60) break
  }

  const padding = end - p
  console.log(`   帧 ${frames.length} 个：${frames.map((x) => `${x.id}(${x.size})`).join(' ')}`)
  console.log(`   帧结束后剩余 ${padding} 字节填充`)
  for (const fr of frames) {
    if (fr.bad) console.log(`   ✗ ${fr.id}: ${fr.bad}`)
  }

  const apic = frames.find((x) => x.id === 'APIC')
  if (apic) {
    const d = apic.at + 10
    const encoding = buf[d]
    let q = d + 1
    let mime = ''
    while (q < d + 120 && buf[q] !== 0) mime += String.fromCharCode(buf[q++])
    const mimeLen = q - (d + 1)
    q += 1
    const picType = buf[q]
    q += 1
    let desc = ''
    const descStart = q
    while (q < d + 600 && buf[q] !== 0) q += 1
    desc = buf.toString('utf8', descStart, q)
    q += 1
    const imgLen = apic.size - (q - d)
    const sig = buf.subarray(q, q + 4)
    const isJpg = sig[0] === 0xff && sig[1] === 0xd8
    const isPng = sig[0] === 0x89 && sig[1] === 0x50
    console.log(
      `   APIC: 编码=${encoding} mime="${mime}"(${mimeLen}) 图片类型=${picType} 描述="${desc}" 图片 ${imgLen} 字节 头=${isJpg ? 'JPEG' : isPng ? 'PNG' : '未知 ' + sig.toString('hex')}`
    )
    if (!isJpg && !isPng) {
      console.log(`   ✗ 封面数据开头不是 JPEG/PNG —— 严格播放器会认为标签损坏`)
      problems += 1
    }
    if (mime === '' && imgLen > 0) {
      console.log(`   ⚠ mime 为空字符串（v2.3 规范要求写 image/jpeg 这类值）`)
    }
  }

  /* 文本帧也看一眼 */
  for (const fr of frames) {
    if (!/^T/.test(fr.id) || fr.id === 'TXXX') continue
    const d = fr.at + 10
    const raw = buf.subarray(d + 1, fr.at + 10 + fr.size)
    let txt = ''
    if (buf[d] === 1 || buf[d] === 2) {
      txt = raw.toString('utf16le').replace(/\0/g, '')
    } else {
      txt = raw.toString('latin1').replace(/\0/g, '')
      if (buf[d] === 3) txt = raw.toString('utf8').replace(/\0/g, '')
    }
    console.log(`   ${fr.id} 编码=${buf[d]} 值="${txt.slice(0, 60)}"`)
  }

  console.log(problems === 0 ? `   ✓ 帧结构自洽，未发现问题\n` : `   ✗ 发现 ${problems} 处问题\n`)
}
