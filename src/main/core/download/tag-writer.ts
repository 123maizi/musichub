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
  /**
   * 专辑艺术家。
   * 播放器按它归类专辑 —— 多条歌手合唱时，用主歌手当专辑艺术家
   * 才不会把一张专辑拆成好几张。
   */
  albumArtist?: string
  /** 音轨号（平台给得出就写） */
  track?: number
  /** 年份（平台给得出就写） */
  year?: number
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
    case 'm4a':
    case 'mp4':
    case 'aac':
      writeMp4Tags(filePath, tag, cover, coverMime)
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
    // TPE2 专辑艺术家：播放器按它归类专辑，不写的话合唱曲会散成一堆
    textFrame('TPE2', tag.albumArtist ?? tag.artist),
    textFrame('TRCK', tag.track ? String(tag.track) : ''),
    textFrame('TYER', tag.year ? String(tag.year) : ''),
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
    ['ALBUMARTIST', tag.albumArtist ?? tag.artist],
    ['TRACKNUMBER', tag.track ? String(tag.track) : ''],
    ['DATE', tag.year ? String(tag.year) : ''],
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

/* ------------------------------------------------------------------ *
 * MP4 / M4A（udta.meta.ilst）
 * ------------------------------------------------------------------ */

/** 构造一个 MP4 盒子 */
function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(payload.length + 8, 0)
  header.write(type, 4, 'latin1')
  return Buffer.concat([header, payload])
}

/** ilst 里的一个条目：data 盒里放 UTF-8 文本 */
function ilstText(type: string, value: string): Buffer {
  const data = Buffer.alloc(8 + Buffer.byteLength(value, 'utf8'))
  data.writeUInt32BE(1, 0) // 类型 1 = UTF-8 文本
  data.writeUInt32BE(0, 4) // 语言/保留
  data.write(value, 8, 'utf8')
  return box(type, data)
}

/** ilst 里的封面条目（类型 13 = JPEG，14 = PNG） */
function ilstCover(cover: Buffer, mime: string): Buffer {
  const typeFlag = mime.includes('png') ? 14 : 13
  const data = Buffer.alloc(8 + cover.length)
  data.writeUInt32BE(typeFlag, 0)
  data.writeUInt32BE(0, 4)
  cover.copy(data, 8)

  // covr 里的 data 盒没有额外层级，直接就是 box('data', ...)
  const inner = Buffer.alloc(8 + data.length)
  inner.writeUInt32BE(data.length + 8, 0)
  inner.write('data', 4, 'latin1')
  data.copy(inner, 8)

  return box('covr', inner)
}

interface Mp4BoxRef {
  offset: number
  size: number
  /** 父盒子在 size 字段里的位置（32 位长度） */
  sizeFieldAt: number
}

/** 沿着 moov → udta → meta → ilst 找出标签相关盒子的位置 */
function locateMp4TagPath(buf: Buffer): {
  moov: Mp4BoxRef
  udta: Mp4BoxRef | null
  meta: Mp4BoxRef | null
  ilst: Mp4BoxRef | null
  mdatOffset: number
} | null {
  // 顶层：找 moov 与 mdat
  let moov: Mp4BoxRef | null = null
  let mdatOffset = -1
  let pos = 0
  while (pos + 8 <= buf.length) {
    const size = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    if (size === 1) return null // 64 位长度，出于安全直接放弃
    if (size < 8 || pos + size > buf.length) break
    if (type === 'moov') moov = { offset: pos, size, sizeFieldAt: pos }
    if (type === 'mdat') mdatOffset = pos
    pos += size
  }
  if (!moov) return null

  /** 在给定父盒子里找子盒子 */
  const childOf = (parent: Mp4BoxRef, type: string, headerSize = 8): Mp4BoxRef | null => {
    let p = parent.offset + headerSize
    const end = parent.offset + parent.size
    while (p + 8 <= end) {
      const size = buf.readUInt32BE(p)
      const kind = buf.toString('latin1', p + 4, p + 8)
      if (size === 1) return null
      if (size < 8 || p + size > end) break
      if (kind === type) return { offset: p, size, sizeFieldAt: p }
      p += size
    }
    return null
  }

  const udta = childOf(moov, 'udta')
  // meta 是「全盒」：8 字节头之后再跟 4 字节版本/标志，所以子元素从 +12 开始
  const meta = udta ? childOf(udta, 'meta', 12) : null
  const ilst = meta ? childOf(meta, 'ilst', 12) : null

  return { moov, udta, meta, ilst, mdatOffset }
}

/** ilst 条目的类型名 */
const MP4_TEXT_KEYS: Record<string, keyof TagInput> = {
  '\xa9nam': 'title',
  '\xa9ART': 'artist',
  '\xa9alb': 'album',
  'aART': 'albumArtist',
  '\xa9day': 'year',
  '\xa9cmt': 'comment'
}

/**
 * 写入 MP4/M4A 标签。
 *
 * 现实情况是「文件里往往已经有标签」—— 实测这个 m4a 已有
 * udta>meta>ilst（标题/歌手/专辑齐全，只是没封面）。
 * 所以做法不是「再套一层」，而是**重建 ilst**：保留我们不认识的条目
 * （比如 `----` 自由格式项），把我们管的字段换成新值，缺的补上，
 * 然后同步更新所有祖先盒子的长度，并按差值修正 chunk 偏移。
 */
function writeMp4Tags(
  filePath: string,
  tag: TagInput,
  cover: Buffer | undefined,
  coverMime: string
): void {
  const original = readFileSync(filePath)

  if (original.toString('latin1', 4, 8) !== 'ftyp') {
    throw new Error('不是有效的 MP4/M4A 文件')
  }

  const path = locateMp4TagPath(original)
  if (!path) throw new Error('MP4 结构无法安全解析（可能是分片 MP4 或 64 位长度），已跳过标签写入')

  // 组装我们要写入的条目
  const wanted: Buffer[] = [
    ilstText('\xa9nam', tag.title),
    ilstText('\xa9ART', tag.artist),
    ilstText('\xa9alb', tag.album),
    ilstText('aART', tag.albumArtist ?? tag.artist)
  ]
  if (tag.year) wanted.push(ilstText('\xa9day', String(tag.year)))
  if (tag.comment) wanted.push(ilstText('\xa9cmt', tag.comment))
  if (cover) wanted.push(ilstCover(cover, coverMime))

  // 保留我们不认识的旧条目（自由格式、歌词等），别把人家原有信息抹掉
  const keep: Buffer[] = []
  if (path.ilst) {
    let p = path.ilst.offset + 8
    const end = path.ilst.offset + path.ilst.size
    while (p + 8 <= end) {
      const size = original.readUInt32BE(p)
      const kind = original.toString('latin1', p + 4, p + 8)
      if (size < 8 || p + size > end) break
      const managed =
        Object.keys(MP4_TEXT_KEYS).some((k) => k === kind) || kind === 'covr'
      if (!managed) keep.push(original.subarray(p, p + size))
      p += size
    }
  }

  const newIlst = box('ilst', Buffer.concat([...keep, ...wanted]))

  /**
   * 决定插入/替换的位置，并算出「文件长度变化量」。
   *
   *   A. 已有 ilst → 原地替换
   *   B. 有 meta 没 ilst → 往 meta 里插一个
   *   C. 有 udta 没 meta → 往 udta 里插 meta
   *   D. 什么都没有 → 往 moov 末尾插 udta
   */
  let insertAt: number
  let removeLength: number
  let insertion: Buffer
  let ancestors: Mp4BoxRef[]

  if (path.ilst && path.meta && path.udta) {
    insertAt = path.ilst.offset
    removeLength = path.ilst.size
    insertion = newIlst
    ancestors = [path.meta, path.udta, path.moov]
  } else if (path.meta && path.udta) {
    insertAt = path.meta.offset + path.meta.size
    removeLength = 0
    insertion = newIlst
    ancestors = [path.meta, path.udta, path.moov]
  } else if (path.udta) {
    const meta = box(
      'meta',
      Buffer.concat([
        Buffer.alloc(4),
        box(
          'hdlr',
          Buffer.concat([
            Buffer.alloc(8),
            Buffer.from('mdir', 'latin1'),
            Buffer.from('appl', 'latin1'),
            Buffer.alloc(9)
          ])
        ),
        newIlst
      ])
    )
    insertAt = path.udta.offset + path.udta.size
    removeLength = 0
    insertion = meta
    ancestors = [path.udta, path.moov]
  } else {
    const udta = box(
      'udta',
      box(
        'meta',
        Buffer.concat([
          Buffer.alloc(4),
          box(
            'hdlr',
            Buffer.concat([
              Buffer.alloc(8),
              Buffer.from('mdir', 'latin1'),
              Buffer.from('appl', 'latin1'),
              Buffer.alloc(9)
            ])
          ),
          newIlst
        ])
      )
    )
    insertAt = path.moov.offset + path.moov.size
    removeLength = 0
    insertion = udta
    ancestors = [path.moov]
  }

  const delta = insertion.length - removeLength

  // 拼出新文件
  const out = Buffer.concat([
    original.subarray(0, insertAt),
    insertion,
    original.subarray(insertAt + removeLength)
  ])

  // 祖先盒子的长度都要跟着变（它们把新内容包在里面了）
  for (const a of ancestors) {
    out.writeUInt32BE(a.size + delta, a.sizeFieldAt)
  }

  /**
   * 修正 chunk 偏移。
   * 只有 mdat 排在 moov 之后时才需要 —— 那时 mdat 整体后移了 delta 字节，
   * 而 stco 里存的是绝对偏移，不修正就会读到错位的数据（文件直接播不了）。
   */
  if (path.mdatOffset > path.moov.offset && delta !== 0) {
    shiftChunkOffsets(out, delta)
  }

  // 自检：第一个 chunk 必须落在文件内，否则宁可放弃
  const firstOffset = readFirstChunkOffset(out)
  if (firstOffset !== null && (firstOffset < 0 || firstOffset >= out.length)) {
    throw new Error('偏移修正自检未通过，已放弃写入标签（原文件未被修改）')
  }

  writeFileSync(filePath, out)
}

/**
 * 修正 chunk 偏移表。
 *
 * 为什么必须做：moov 通常在 mdat 之前（faststart 布局），往 moov 里插标签
 * 会把后面所有数据往后推，而 stco/co64 里存的是**绝对文件偏移** ——
 * 不修正的话，播放器按旧偏移去读，读到的就是错位的数据。
 * 这正是「加了标签之后文件打不开」的典型原因。
 */
function shiftChunkOffsets(data: Buffer, delta: number): void {
  // 遍历 moov 里所有 trak/mdia/minf/stbl/stco|co64
  const visit = (from: number, to: number): void => {
    let pos = from
    while (pos + 8 <= to) {
      const size = data.readUInt32BE(pos)
      const type = data.toString('latin1', pos + 4, pos + 8)
      if (size < 8 || pos + size > to) break

      if (type === 'stco') {
        const count = data.readUInt32BE(pos + 12)
        for (let i = 0; i < count; i += 1) {
          const at = pos + 16 + i * 4
          if (at + 4 > pos + size) break
          data.writeUInt32BE(data.readUInt32BE(at) + delta, at)
        }
      } else if (type === 'co64') {
        const count = data.readUInt32BE(pos + 12)
        for (let i = 0; i < count; i += 1) {
          const at = pos + 16 + i * 8
          if (at + 8 > pos + size) break
          data.writeBigUInt64BE(data.readBigUInt64BE(at) + BigInt(delta), at)
        }
      } else if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'meta'].includes(type)) {
        // meta 盒在 QuickTime 里前 4 字节是版本号，偏移要加 4
        const childStart = pos + (type === 'meta' ? 12 : 8)
        if (childStart < pos + size) visit(childStart, pos + size)
      }

      pos += size
    }
  }
  visit(0, data.length)
}

/** 读出第一个 chunk 偏移，用于自检 */
function readFirstChunkOffset(data: Buffer): number | null {
  let found: number | null = null
  const visit = (from: number, to: number): void => {
    if (found !== null) return
    let pos = from
    while (pos + 8 <= to) {
      const size = data.readUInt32BE(pos)
      const type = data.toString('latin1', pos + 4, pos + 8)
      if (size < 8 || pos + size > to) break
      if (type === 'stco') {
        const count = data.readUInt32BE(pos + 12)
        if (count > 0) found = data.readUInt32BE(pos + 16)
        return
      }
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) {
        visit(pos + 8, pos + size)
      }
      pos += size
      if (found !== null) return
    }
  }
  visit(0, data.length)
  return found
}
