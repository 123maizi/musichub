/**
 * 逐个检查 m4a 的盒子结构。
 * v1.0.8 给 m4a 加了标签写入（手写 MP4 盒子树 + chunk 偏移修正），
 * 必须确认它没有把文件写坏。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'C:\\Users\\18509\\Desktop\\歌曲下载'
const files = readdirSync(dir).filter((f) => /\.(m4a|mp4|aac)$/i.test(f))

const NAMES = {
  ftyp: '文件类型', moov: '媒体信息', mdat: '音频数据', free: '空闲',
  udta: '用户数据', meta: '元数据', ilst: '标签列表', moof: '分片'
}

console.log(`\n检查 ${files.length} 个 m4a`)
console.log('='.repeat(76))

for (const name of files) {
  const buf = readFileSync(join(dir, name))
  console.log(`\n${name.length > 52 ? name.slice(0, 52) + '…' : name}`)
  console.log(`  大小 ${(buf.length / 1024).toFixed(1)} KB`)

  let pos = 0
  const tops = []
  let moovOff = -1
  let mdatOff = -1
  let broken = false

  while (pos + 8 <= buf.length) {
    const size = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    if (size < 8 || pos + size > buf.length) {
      console.log(`  ✗ 盒子 ${type} 声明长度 ${size}，越界（文件可能被写坏）`)
      broken = true
      break
    }
    tops.push(`${type}(${size})`)
    if (type === 'moov') moovOff = pos
    if (type === 'mdat') mdatOff = pos
    pos += size
  }

  console.log(`  顶层盒子: ${tops.join(' ')}`)
  if (broken) continue
  if (pos !== buf.length) {
    console.log(`  ⚠ 解析到 ${pos}，文件长 ${buf.length}，尾部有 ${buf.length - pos} 字节没被任何盒子覆盖`)
  }

  /* moov 内部关键信息 */
  if (moovOff >= 0) {
    const moovEnd = moovOff + buf.readUInt32BE(moovOff)
    let p = moovOff + 8
    const inner = []
    let udtaAt = -1
    while (p + 8 <= moovEnd) {
      const size = buf.readUInt32BE(p)
      const type = buf.toString('latin1', p + 4, p + 8)
      if (size < 8 || p + size > moovEnd) {
        inner.push(`${type}(越界!)`)
        break
      }
      inner.push(type)
      if (type === 'udta') udtaAt = p
      p += size
    }
    console.log(`  moov 内: ${inner.join(' ')}`)

    /* 第一个 chunk 偏移必须落在 mdat 里 */
    const stco = findStco(buf)
    if (stco !== null) {
      const inMdat = mdatOff >= 0 && stco >= mdatOff && stco < buf.length
      console.log(
        `  首个音频块偏移 ${stco}，mdat 起点 ${mdatOff} → ${inMdat ? '✓ 落在音频数据内' : '✗ 指向了错误位置（文件会播不了）'}`
      )
    } else {
      console.log('  ⚠ 找不到 stco（分片 MP4？）')
    }

    /* 标签是否写进去了 */
    const hasIlst = buf.includes(Buffer.from('ilst', 'latin1'))
    const hasCovr = buf.includes(Buffer.from('covr', 'latin1'))
    const hasNam = buf.includes(Buffer.from('\xa9nam', 'latin1'))
    console.log(`  标签: name=${hasNam ? '有' : '无'} 封面=${hasCovr ? '有' : '无'}`)
  }
}

function findStco(buf) {
  let found = null
  const visit = (from, to, depth) => {
    if (found !== null || depth > 6) return
    let p = from
    while (p + 8 <= to) {
      const size = buf.readUInt32BE(p)
      const type = buf.toString('latin1', p + 4, p + 8)
      if (size < 8 || p + size > to) break
      if (type === 'stco') {
        const count = buf.readUInt32BE(p + 12)
        if (count > 0) found = buf.readUInt32BE(p + 16)
        return
      }
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) visit(p + 8, p + size, depth + 1)
      p += size
    }
  }
  visit(0, buf.length, 0)
  return found
}

console.log(`\n${'='.repeat(76)}`)
