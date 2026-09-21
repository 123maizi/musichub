/**
 * 看 MP4/M4A 的顶层盒子布局。
 *
 * 判断能不能安全地往里加标签：
 *   · moov 在 mdat 之后 → 直接追加就行，绝对安全
 *   · moov 在 mdat 之前 → 插入会让所有 stco 偏移失效，
 *     必须同步修正 chunk offset 表，否则文件直接播不了
 */
import { readFileSync } from 'node:fs'

const path = process.argv[2] ?? 'C:\\Users\\18509\\Desktop\\歌曲下载\\蛋堡 - 收敛水.m4a'
const buf = readFileSync(path)

console.log(`文件: ${path}`)
console.log(`大小: ${(buf.length / 1024 / 1024).toFixed(2)} MB`)
console.log('='.repeat(70))

let pos = 0
const boxes = []
while (pos + 8 <= buf.length) {
  const size = buf.readUInt32BE(pos)
  const type = buf.toString('latin1', pos + 4, pos + 8)
  let headerSize = 8
  let realSize = size

  if (size === 1) {
    // 64 位扩展长度
    const big = buf.readBigUInt64BE(pos + 8)
    realSize = Number(big)
    headerSize = 16
  } else if (size === 0) {
    realSize = buf.length - pos
  }

  boxes.push({ type, offset: pos, size: realSize, headerSize })
  console.log(`  ${type.padEnd(6)} 偏移=${String(pos).padStart(9)}  长度=${String(realSize).padStart(9)}`)

  if (realSize <= 0) break
  pos += realSize
  if (boxes.length > 12) {
    console.log('  …（盒子过多，停止）')
    break
  }
}

console.log('='.repeat(70))

const moov = boxes.find((b) => b.type === 'moov')
const mdat = boxes.find((b) => b.type === 'mdat')

if (!moov || !mdat) {
  console.log('缺少 moov 或 mdat，不是标准 MP4')
} else if (moov.offset > mdat.offset) {
  console.log('moov 在 mdat 之后 → 直接追加标签是安全的（不需要动任何偏移表）')
} else {
  console.log('⚠ moov 在 mdat 之前（faststart 布局）→ 插入标签会移动 mdat，')
  console.log('  必须同步修正 stco/co64 里的 chunk 偏移，否则文件会播不了')
}

// 看看 moov 内部有没有 udta（放标签的地方）
if (moov) {
  const inside = buf.subarray(moov.offset, moov.offset + Math.min(moov.size, 4096))
  const has = (tag) => inside.includes(Buffer.from(tag, 'latin1'))
  console.log('')
  console.log(`moov 里是否已有 udta: ${has('udta') ? '是' : '否'}`)
  console.log(`moov 里是否已有 meta: ${has('meta') ? '是' : '否'}`)
  console.log(`moov 里是否已有 ilst: ${has('ilst') ? '是' : '否'}`)
}
