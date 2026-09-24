/**
 * 修复被写坏的 COMM 帧。
 *
 * 老版本写入器把 UTF-16 描述串的结束符写成了一个 00（应为两个），
 * 导致整个正文错位、Media Foundation 拒播。这里做外科手术式修复：
 * 只把那一个字节补上，同时更新帧长和标签长，其他帧（含封面）原样保留。
 *
 * 默认只扫描不修改；加 --write 才真正落盘，且先备份。
 */
import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = process.argv[2] || 'C:\\Users\\18509\\Desktop\\歌曲下载'
const WRITE = process.argv.includes('--write')
const BACKUP = 'F:\\MusicHub\\.tmp\\tag-repair-backup'

const syncsafe = (b) => ((b[0] & 0x7f) << 21) | ((b[1] & 0x7f) << 14) | ((b[2] & 0x7f) << 7) | (b[3] & 0x7f)
const ss32 = (n) => Buffer.from([(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f])

/**
 * 判断一个 COMM 帧是否是「UTF-16 却只写了一个结束符」的坏帧。
 * 返回需要插入结束符的位置（相对帧数据起点），或者 null 表示没问题。
 *
 * 我们的写入器总是写「空描述」，所以形态是可精确判定的：
 *   正常：  04 05 = 00 00        ，正文 BOM 落在 06 07
 *   坏掉：  04    = 00（少一个），正文 BOM 被挤到 05 06
 * 正文 BOM 的位置就是判据 —— 不能靠扫 00 00，因为正文错位后
 * 每两个 UTF-16LE 字符之间都可能凑出 00 00，扫描会跑偏。
 */
function brokenAt(data) {
  const enc = data[0]
  if (enc !== 1 && enc !== 2) return null
  if (data.length < 8) return null
  // UTF-16LE 的 BOM 是 ff fe，UTF-16BE 是 fe ff
  const b1 = enc === 1 ? 0xff : 0xfe
  const b2 = enc === 1 ? 0xfe : 0xff

  // 正常：描述结束符两字节齐全，BOM 在 06 07
  if (data[4] === 0x00 && data[5] === 0x00 && data[6] === b1 && data[7] === b2) return null
  // 坏掉：结束符只有一字节，BOM 在 05 06
  if (data[4] === 0x00 && data[5] === b1 && data[6] === b2) return 5
  return null
}

const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.mp3'))
console.log(`扫描 ${DIR} 下的 ${files.length} 个 mp3\n`)

const broken = []
for (const f of files) {
  const p = join(DIR, f)
  const buf = readFileSync(p)
  if (buf.toString('ascii', 0, 3) !== 'ID3') continue
  const tagSize = syncsafe(buf.subarray(6, 10))
  const tagEnd = 10 + tagSize

  let q = 10
  let hit = null
  while (q + 10 <= tagEnd) {
    const id = buf.toString('ascii', q, q + 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    const size = buf.readUInt32BE(q + 4)
    if (id === 'COMM') {
      const data = buf.subarray(q + 10, q + 10 + size)
      const at = brokenAt(data)
      if (at !== null) hit = { frameAt: q, size, at }
    }
    q += 10 + size
  }
  if (hit) {
    broken.push({ file: f, path: p, ...hit })
    console.log(`✗ ${f}  COMM 帧 @${hit.frameAt} 长 ${hit.size}，需在偏移 ${hit.at} 补一个 00`)
  } else {
    console.log(`✓ ${f}`)
  }
}

console.log(`\n受影响: ${broken.length} / ${files.length}`)

if (!WRITE) {
  console.log('\n（这是只读扫描；加 --write 才会真正修复并备份）')
  process.exit(0)
}
if (broken.length === 0) process.exit(0)

mkdirSync(BACKUP, { recursive: true })
console.log(`\n开始修复，备份到 ${BACKUP}`)

for (const b of broken) {
  copyFileSync(b.path, join(BACKUP, b.file))

  const buf = readFileSync(b.path)
  const tagSize = syncsafe(buf.subarray(6, 10))
  const tagEnd = 10 + tagSize
  const dataStart = b.frameAt + 10
  const data = buf.subarray(dataStart, dataStart + b.size)

  // 在 at 位置插入一个 00
  const fixedData = Buffer.concat([data.subarray(0, b.at), Buffer.from([0x00]), data.subarray(b.at)])

  const header = Buffer.alloc(10)
  header.write('COMM', 0, 'ascii')
  header.writeUInt32BE(fixedData.length, 4)

  const out = Buffer.concat([
    buf.subarray(0, b.frameAt),
    header,
    fixedData,
    buf.subarray(dataStart + b.size)
  ])

  // 更新标签总长
  const newTagSize = tagSize + 1
  ss32(newTagSize).copy(out, 6)

  writeFileSync(b.path, out)

  // 自检
  const check = readFileSync(b.path)
  const cs = syncsafe(check.subarray(6, 10))
  const ced = 10 + cs
  let cq = 10
  let ok = false
  while (cq + 10 <= ced) {
    const id = check.toString('ascii', cq, cq + 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    const size = check.readUInt32BE(cq + 4)
    if (id === 'COMM') {
      const d = check.subarray(cq + 10, cq + 10 + size)
      const bom = d.subarray(6, 8)
      ok = bom[0] === 0xff && bom[1] === 0xfe
    }
    cq += 10 + size
  }
  const audioSync = check[ced] === 0xff && (check[ced + 1] & 0xe0) === 0xe0
  console.log(
    `  ${b.file} → 标签 ${tagSize}→${newTagSize}，COMM 已修: ${ok ? '✓' : '✗'}，音频同步字: ${audioSync ? '✓' : '✗'}`
  )
}
console.log('\n修复完成')
