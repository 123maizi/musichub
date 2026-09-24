/**
 * 把「导致 Windows Media Foundation 拒播」的那一帧找出来。
 *
 * 做法：从出问题的文件里造几个变体（去掉整段标签 / 去掉封面 / 只留标题 / 去掉注释），
 * 再用 MF 逐个打开。MF 能打开哪个，问题就在被去掉的那一部分。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'C:\\Users\\18509\\Desktop\\歌曲下载\\Corbon Amodio - lucy~.mp3'
const OUT = 'F:\\MusicHub\\.tmp\\id3-bisect'
mkdirSync(OUT, { recursive: true })

const buf = readFileSync(SRC)
const syncsafe = (b) => ((b[0] & 0x7f) << 21) | ((b[1] & 0x7f) << 14) | ((b[2] & 0x7f) << 7) | (b[3] & 0x7f)
const u32 = (b) => ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0
const be32 = (n) => Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
const ss32 = (n) => Buffer.from([(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f])

const tagSize = syncsafe(buf.subarray(6, 10))
const tagEnd = 10 + tagSize
const audio = buf.subarray(tagEnd)

/* 解析出所有帧的原始字节 */
const framesRaw = []
let p = 10
while (p + 10 <= tagEnd) {
  const id = buf.toString('ascii', p, p + 4)
  if (!/^[A-Z0-9]{4}$/.test(id)) break
  const size = u32(buf.subarray(p + 4, p + 8))
  const total = 10 + size
  framesRaw.push({ id, bytes: buf.subarray(p, p + total) })
  p += total
}

console.log(`源文件: ${buf.length} 字节`)
console.log(`标签: ${tagEnd} 字节, 音频: ${audio.length} 字节`)
console.log(`帧: ${framesRaw.map((f) => `${f.id}(${f.bytes.length})`).join(' ')}\n`)

/** 按 ID3v2.3 规范重建标签：帧大小用普通 32 位大端，标签大小用 syncsafe */
function buildTag(frames, padding = 0) {
  let body = Buffer.alloc(0)
  for (const f of frames) body = Buffer.concat([body, f.bytes])
  const pad = Buffer.alloc(padding)
  const header = Buffer.concat([
    Buffer.from('ID3', 'ascii'),
    Buffer.from([3, 0, 0]),
    ss32(body.length + padding)
  ])
  return Buffer.concat([header, body, pad])
}

const variants = [
  { name: '00-原始', data: buf },
  { name: '01-整段标签去掉', data: audio },
  { name: '02-去掉APIC封面', data: Buffer.concat([buildTag(framesRaw.filter((f) => f.id !== 'APIC')), audio]) },
  { name: '03-去掉COMM', data: Buffer.concat([buildTag(framesRaw.filter((f) => f.id !== 'COMM')), audio]) },
  { name: '04-只留TIT2', data: Buffer.concat([buildTag(framesRaw.filter((f) => f.id === 'TIT2')), audio]) },
  { name: '05-只留APIC', data: Buffer.concat([buildTag(framesRaw.filter((f) => f.id === 'APIC')), audio]) },
  {
    name: '06-全部标签+1024填充',
    data: Buffer.concat([buildTag(framesRaw, 1024), audio])
  },
  {
    name: '07-标签改ID3v2.4',
    data: (() => {
      let body = Buffer.alloc(0)
      for (const f of framesRaw) {
        // v2.4 帧大小用 syncsafe
        const size = f.bytes.length - 10
        body = Buffer.concat([
          body,
          Buffer.concat([
            Buffer.from(f.id, 'ascii'),
            ss32(size),
            Buffer.from([0, 0]),
            f.bytes.subarray(10)
          ])
        ])
      }
      const header = Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.from([4, 0, 0]), ss32(body.length)])
      return Buffer.concat([header, body, audio])
    })()
  }
]

const written = []
for (const v of variants) {
  const path = join(OUT, `${v.name}.mp3`)
  writeFileSync(path, v.data)
  written.push(path)
  console.log(`${v.name}.mp3  ${v.data.length} 字节`)
}

console.log('\n' + written.join('\n'))
