/**
 * 音频标签写入器（纯手写，不依赖任何第三方库）
 *
 * 支持：
 *  - MP3  → ID3v2.3（标题 / 艺术家 / 专辑 / 注释 / 内嵌封面）
 *  - FLAC → Vorbis Comment + PICTURE 块
 *
 * 为什么自己写：商业音频库要么收费要么体积巨大，而这里需要的写入能力很有限，
 * 手写能精确控制字节布局，也不引入原生依赖。
 * 暂不支持 M4A/MP4 —— 其 atom 结构改写风险较高，留待后续。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'

export interface TagInput {
  title: string
  artist: string
  album: string
  /** 封面地址，会下载后内嵌 */
  coverUrl?: string
  comment?: string
}

/** 写入标签，按文件扩展名分发 */
export async function writeAudioTag(filePath: string, tag: TagInput): Promise<void> {
  if (!existsSync(filePath)) throw new Error('文件不存在')

  const ext = extname(filePath).toLowerCase().replace('.', '')

  let cover: Buffer | undefined
  let coverMime = 'image/jpeg'
  if (tag.coverUrl) {
    const fetched = await fetchCover(tag.coverUrl)
    if (fetched) {
      cover = fetched.data
      coverMime = fetched.mime
    }
  }

  switch (ext) {
    case 'mp3':
      writeId3v23(filePath, tag, cover, coverMime)
      return
    case 'flac':
      writeFlacTags(filePath, tag, cover, coverMime)
      return
    default:
      throw new Error(`暂不支持写入 .${ext} 的标签`)
  }
}

/* ------------------------------------------------------------------ *
 * 封面获取
 * ------------------------------------------------------------------ */

async function fetchCover(url: string): Promise<{ data: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: new URL(url).origin + '/' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow'
    })
    if (!res.ok) return null
    const data = Buffer.from(await res.arrayBuffer())
    if (data.length === 0 || data.length > 8 * 1024 * 1024) return null

    const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || sniffMime(data)
    return { data, mime: mime.startsWith('image/') ? mime : sniffMime(data) }
  } catch {
    return null
  }
}

/** 由文件头猜测图片类型 */
function sniffMime(data: Buffer): string {
  if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50) return 'image/png'
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg'
  if (data.length > 12 && data.toString('ascii', 0, 4) === 'RIFF') return 'image/webp'
  if (data.length > 6 && data.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
  return 'image/jpeg'
}

/** 从图片数据里解析宽高（FLAC PICTURE 块需要） */
function imageSize(data: Buffer): { width: number; height: number } {
  // PNG: IHDR 紧跟 8 字节签名 + 4 字节长度 + 4 字节类型
  if (data.length > 24 && data[0] === 0x89 && data[1] === 0x50) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  }
  // JPEG: 遍历段找 SOF0/SOF2
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = data[offset + 1]
      const isSOF =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      if (isSOF) {
        return {
          height: data.readUInt16BE(offset + 5),
          width: data.readUInt16BE(offset + 7)
        }
      }
      const segLen = data.readUInt16BE(offset + 2)
      if (segLen <= 0) break
      offset += 2 + segLen
    }
  }
  return { width: 0, height: 0 }
}

/* ------------------------------------------------------------------ *
 * ID3v2.3（MP3）
 * ------------------------------------------------------------------ */

/** 4 字节 synchsafe 整数（每字节只用低 7 位） */
function synchsafe(size: number): Buffer {
  return Buffer.from([
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f
  ])
}

function readSynchsafe(buf: Buffer, offset: number): number {
  return (
    ((buf[offset] & 0x7f) << 21) |
    ((buf[offset + 1] & 0x7f) << 14) |
    ((buf[offset + 2] & 0x7f) << 7) |
    (buf[offset + 3] & 0x7f)
  )
}

/**
 * 构造文本帧。
 * 中文必须用 UTF-16LE + BOM（编码字节 0x01），
 * 用 0x00(ISO-8859-1) 会直接乱码，这是 ID3 写入最常见的坑。
 */
function textFrame(id: string, text: string): Buffer | null {
  if (!text) return null
  const body = Buffer.concat([Buffer.from([0x01]), Buffer.from(`\uFEFF${text}`, 'utf16le')])
  const header = Buffer.alloc(10)
  header.write(id, 0, 'ascii')
  header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, body])
}

/** 构造注释帧 COMM */
function commentFrame(text: string): Buffer | null {
  if (!text) return null
  const body = Buffer.concat([
    Buffer.from([0x01]), // UTF-16 with BOM
    Buffer.from('XXX\0', 'latin1'), // 语言
    Buffer.from('\uFEFF' + text, 'utf16le')
  ])
  const header = Buffer.alloc(10)
  header.write('COMM', 0, 'ascii')
  header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, body])
}

/** 构造封面帧 APIC */
function apicFrame(cover: Buffer, mime: string): Buffer {
  const body = Buffer.concat([
    Buffer.from([0x00]), // 文本编码 latin1
    Buffer.from(`${mime}\0`, 'latin1'),
    Buffer.from([0x03]), // 图片类型：封面
    Buffer.from('\0', 'latin1'), // 空描述
    cover
  ])
  const header = Buffer.alloc(10)
  header.write('APIC', 0, 'ascii')
  header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, body])
}

/** 剥掉已有的 ID3v2 头，避免重复写入 */
function stripExistingId3(data: Buffer): Buffer {
  if (data.length < 10) return data
  if (data.toString('ascii', 0, 3) !== 'ID3') return data
  const size = readSynchsafe(data, 6)
  const flags = data[5]
  let offset = 10 + size
  if (flags & 0x10) offset += 10 // 存在 footer
  return offset < data.length ? data.subarray(offset) : Buffer.alloc(0)
}

function writeId3v23(
  filePath: string,
  tag: TagInput,
  cover: Buffer | undefined,
  coverMime: string
): void {
  const data = readFileSync(filePath)
  const audio = stripExistingId3(data)

  const frames = [
    textFrame('TIT2', tag.title),
    textFrame('TPE1', tag.artist),
    textFrame('TALB', tag.album),
    commentFrame(tag.comment ?? ''),
    cover ? apicFrame(cover, coverMime) : null
  ].filter((f): f is Buffer => f !== null)

  const body = Buffer.concat(frames)
  const header = Buffer.alloc(10)
  header.write('ID3', 0, 'ascii')
  header[3] = 0x03 // 主版本
  header[4] = 0x00 // 修订号
  header[5] = 0x00 // flags
  synchsafe(body.length).copy(header, 6)

  writeFileSync(filePath, Buffer.concat([header, body, audio]))
}

/* ------------------------------------------------------------------ *
 * FLAC（Vorbis Comment + PICTURE）
 * ------------------------------------------------------------------ */

function buildVorbisComment(tag: TagInput): Buffer {
  const vendor = Buffer.from('MusicHub', 'utf8')
  const entries: [string, string][] = [
    ['TITLE', tag.title],
    ['ARTIST', tag.artist],
    ['ALBUM', tag.album],
    ['COMMENT', tag.comment ?? '']
  ].filter(([, v]) => Boolean(v)) as [string, string][]

  const parts: Buffer[] = []
  const vendorLen = Buffer.alloc(4)
  vendorLen.writeUInt32LE(vendor.length, 0)
  parts.push(vendorLen, vendor)

  const count = Buffer.alloc(4)
  count.writeUInt32LE(entries.length, 0)
  parts.push(count)

  for (const [key, value] of entries) {
    const text = Buffer.from(`${key}=${value}`, 'utf8')
    const len = Buffer.alloc(4)
    len.writeUInt32LE(text.length, 0)
    parts.push(len, text)
  }

  return Buffer.concat(parts)
}

function buildFlacPicture(cover: Buffer, mime: string): Buffer {
  const { width, height } = imageSize(cover)
  const mimeBuf = Buffer.from(mime, 'ascii')
  const desc = Buffer.alloc(0)

  const head = Buffer.alloc(4)
  head.writeUInt32BE(3, 0) // 类型 3 = 封面

  const mimeLen = Buffer.alloc(4)
  mimeLen.writeUInt32BE(mimeBuf.length, 0)

  const descLen = Buffer.alloc(4)
  descLen.writeUInt32BE(desc.length, 0)

  const dims = Buffer.alloc(16)
  dims.writeUInt32BE(width, 0)
  dims.writeUInt32BE(height, 4)
  dims.writeUInt32BE(24, 8) // 色深
  dims.writeUInt32BE(0, 12) // 索引色数量

  const dataLen = Buffer.alloc(4)
  dataLen.writeUInt32BE(cover.length, 0)

  return Buffer.concat([head, mimeLen, mimeBuf, descLen, desc, dims, dataLen, cover])
}

function writeFlacTags(
  filePath: string,
  tag: TagInput,
  cover: Buffer | undefined,
  coverMime: string
): void {
  const data = readFileSync(filePath)
  if (data.length < 8 || data.toString('ascii', 0, 4) !== 'fLaC') {
    throw new Error('不是有效的 FLAC 文件')
  }

  // 解析元数据块
  let pos = 4
  const blocks: { type: number; data: Buffer }[] = []
  let last = false

  while (!last && pos + 4 <= data.length) {
    const headerByte = data[pos]
    last = (headerByte & 0x80) !== 0
    const type = headerByte & 0x7f
    const len = (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]
    if (pos + 4 + len > data.length) break
    blocks.push({ type, data: data.subarray(pos + 4, pos + 4 + len) })
    pos += 4 + len
  }

  const audio = data.subarray(pos)

  // 移除旧的 VORBIS_COMMENT(4) 与 PICTURE(6)
  const kept = blocks.filter((b) => b.type !== 4 && b.type !== 6)
  kept.push({ type: 4, data: buildVorbisComment(tag) })
  if (cover) kept.push({ type: 6, data: buildFlacPicture(cover, coverMime) })

  // 重新组装，仅最后一个块带 last 标志
  const chunks: Buffer[] = [Buffer.from('fLaC', 'ascii')]
  kept.forEach((block, index) => {
    const header = Buffer.alloc(4)
    header[0] = (index === kept.length - 1 ? 0x80 : 0x00) | block.type
    header.writeUIntBE(block.data.length, 1, 3)
    chunks.push(header, block.data)
  })
  chunks.push(audio)

  writeFileSync(filePath, Buffer.concat(chunks))
}
