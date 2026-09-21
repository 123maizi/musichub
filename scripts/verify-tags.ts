/**
 * 验证标签写入器不会写坏文件。
 *
 * 重点测 M4A：它是手写 MP4 盒子树 + chunk 偏移修正，
 * 一旦算错，文件会直接播不了 —— 而「文件损坏」正是用户报的问题，
 * 绝不能用一个新的损坏源去修旧的。
 *
 * 做法：复制真实文件 → 写标签 → 重新解析结构自检。
 * 解码能不能过由 scripts/probe-decode-tagged.mjs 在 Chromium 里验。
 */
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeAudioTag } from '../src/main/core/download/tag-writer'
import { sniffAudioFormat } from '../src/main/core/download/audio-format'

const SRC_DIR = 'C:\\Users\\18509\\Desktop\\歌曲下载'
const OUT_DIR = '.tmp\\tagtest'

if (!existsSync(OUT_DIR)) {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(OUT_DIR, { recursive: true })
}

/** 列出顶层 MP4 盒子 */
function mp4Boxes(buf: Buffer): { type: string; offset: number; size: number }[] {
  const out: { type: string; offset: number; size: number }[] = []
  let pos = 0
  while (pos + 8 <= buf.length) {
    const size = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const real = size === 1 ? Number(buf.readBigUInt64BE(pos + 8)) : size
    if (real < 8 || pos + real > buf.length) {
      out.push({ type: `${type}(越界!)`, offset: pos, size: real })
      break
    }
    out.push({ type, offset: pos, size: real })
    pos += real
    if (out.length > 20) break
  }
  return out
}

/** 读第一个 chunk 偏移 */
function firstChunkOffset(buf: Buffer): number | null {
  let found: number | null = null
  const visit = (from: number, to: number): void => {
    if (found !== null) return
    let pos = from
    while (pos + 8 <= to) {
      const size = buf.readUInt32BE(pos)
      const type = buf.toString('latin1', pos + 4, pos + 8)
      if (size < 8 || pos + size > to) break
      if (type === 'stco') {
        const count = buf.readUInt32BE(pos + 12)
        if (count > 0) found = buf.readUInt32BE(pos + 16)
        return
      }
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) visit(pos + 8, pos + size)
      pos += size
      if (found !== null) return
    }
  }
  visit(0, buf.length)
  return found
}

const cases = [
  { file: '蛋堡 - 收敛水.m4a', label: 'M4A' },
  { file: 'Army Of Lovers - Crucified.mp3', label: 'MP3' },
  { file: '20 Min - Lil Uzi Vert.flac', label: 'FLAC' }
]

console.log(`\n标签写入安全性验证`)
console.log('='.repeat(78))

for (const c of cases) {
  const src = join(SRC_DIR, c.file)
  if (!existsSync(src)) {
    console.log(`\n${c.label}: 跳过（源文件不存在）`)
    continue
  }
  const dst = join(OUT_DIR, `tagged.${c.file.split('.').pop()}`)
  copyFileSync(src, dst)

  const before = readFileSync(dst)
  const beforeSize = before.length
  const beforeChunk = firstChunkOffset(before)

  console.log(`\n${c.label}  ${c.file.slice(0, 45)}`)
  console.log(`  写入前: ${(beforeSize / 1024).toFixed(1)} KB`)

  try {
    await writeAudioTag(dst, {
      title: '测试标题',
      artist: '测试歌手',
      album: '测试专辑',
      albumArtist: '测试歌手',
      track: 3,
      year: 2026,
      comment: 'MusicHub 标签测试'
    })
  } catch (err) {
    console.log(`  写入失败: ${(err as Error).message}`)
    continue
  }

  const after = readFileSync(dst)
  const afterChunk = firstChunkOffset(after)
  const delta = after.length - beforeSize

  console.log(`  写入后: ${(after.length / 1024).toFixed(1)} KB（增加 ${delta} 字节）`)
  console.log(`  文件头仍是音频: ${sniffAudioFormat(after) ? '✓ ' + sniffAudioFormat(after)!.label : '✗ 不是音频了！'}`)

  if (c.label === 'M4A') {
    const boxes = mp4Boxes(after)
    console.log(`  顶层盒子: ${boxes.map((b) => `${b.type}(${b.size})`).join(' ')}`)
    const ok = boxes.every((b) => !b.type.includes('越界'))
    console.log(`  盒子结构自洽: ${ok ? '✓' : '✗'}`)
    console.log(`  首个 chunk 偏移: ${beforeChunk} → ${afterChunk}（应等于原值 + ${delta}）`)
    const expected = beforeChunk !== null ? beforeChunk + delta : null
    console.log(`  偏移修正正确: ${afterChunk === expected ? '✓' : `✗ 期望 ${expected}，实际 ${afterChunk}`}`)
    console.log(`  偏移落在文件内: ${afterChunk !== null && afterChunk < after.length ? '✓' : '✗'}`)
    // 标签是否真的写进去了
    const hasIlst = after.includes(Buffer.from('ilst', 'latin1'))
    const hasNam = after.includes(Buffer.from('\xa9nam', 'latin1'))
    console.log(`  标签已写入: ${hasIlst && hasNam ? '✓' : '✗'}`)
  } else if (c.label === 'MP3') {
    const id3Size =
      ((after[6] & 0x7f) << 21) | ((after[7] & 0x7f) << 14) | ((after[8] & 0x7f) << 7) | (after[9] & 0x7f)
    const audioAt = 10 + id3Size
    const sync = after[audioAt] === 0xff && (after[audioAt + 1] & 0xe0) === 0xe0
    console.log(`  ID3 长度 ${id3Size}，音频从 ${audioAt} 开始，同步字: ${sync ? '✓' : '✗'}`)
    console.log(`  含 TPE2(专辑艺术家): ${after.includes(Buffer.from('TPE2', 'latin1')) ? '✓' : '✗'}`)
  } else if (c.label === 'FLAC') {
    let pos = 4
    let streamFirst = false
    let lastCount = 0
    let types: string[] = []
    for (let i = 0; i < 20; i += 1) {
      const hb = after[pos]
      const last = (hb & 0x80) !== 0
      const type = hb & 0x7f
      const len = (after[pos + 1] << 16) | (after[pos + 2] << 8) | after[pos + 3]
      types.push(`${type}(${len})`)
      if (i === 0 && type === 0) streamFirst = true
      if (last) {
        lastCount += 1
        pos += 4 + len
        break
      }
      pos += 4 + len
    }
    console.log(`  块序列: ${types.join(' ')}`)
    console.log(`  STREAMINFO 仍在首位: ${streamFirst ? '✓' : '✗'}`)
    console.log(`  last 标志唯一: ${lastCount === 1 ? '✓' : '✗'}`)
    const sync = after[pos] === 0xff && (after[pos + 1] & 0xfc) === 0xf8
    console.log(`  音频帧同步字: ${sync ? '✓' : '✗'}`)
  }
}

console.log(`\n${'='.repeat(78)}`)
console.log(`产物在 ${OUT_DIR}，接着用 Chromium 验能不能解码`)
