/**
 * 音频格式识别
 *
 * 用途：下载完成后校验「下下来的确实是音频」。
 *
 * 为什么必须校验：音源出问题时，返回的地址可能指向一个 HTML 错误页、
 * 一段 JSON、甚至一个空响应。这些内容照样会被写进文件、任务照样显示
 * 「已完成」，直到用户去播放才发现「文件损坏」—— 那时候已经晚了，
 * 用户拿到的是一个看起来正常、其实打不开的文件。
 *
 * 所以这里按文件头指纹判断真实格式，对不上就让下载判失败并删掉文件，
 * 宁可明确报错，也不留一个假装成功的坏文件。
 */

/** 常见音频格式的文件头指纹 */
export interface AudioFormat {
  /** 扩展名（不含点） */
  ext: string
  /** 人类可读的名字 */
  label: string
}

/**
 * 按文件头判断音频格式；不是音频则返回 null。
 *
 * 注意判空的边界：至少要有 12 个字节才能覆盖 MP4 的 'ftyp'，
 * 短于这个长度的一律当无效（正常音频不可能这么短）。
 */
export function sniffAudioFormat(buf: Buffer): AudioFormat | null {
  if (!buf || buf.length < 12) return null

  const ascii = (offset: number, len: number): string =>
    buf.toString('latin1', offset, offset + len)

  // MP3：可能带 ID3v2 标签，也可能是裸帧
  if (ascii(0, 3) === 'ID3') return { ext: 'mp3', label: 'MP3' }
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return { ext: 'mp3', label: 'MP3' }

  if (ascii(0, 4) === 'fLaC') return { ext: 'flac', label: 'FLAC' }
  if (ascii(0, 4) === 'OggS') return { ext: 'ogg', label: 'OGG' }
  if (ascii(0, 4) === 'RIFF') return { ext: 'wav', label: 'WAV' }
  if (ascii(0, 4) === 'MAC ') return { ext: 'ape', label: 'APE' }
  // MP4 家族：fftyp 在偏移 4
  if (ascii(4, 4) === 'ftyp') return { ext: 'm4a', label: 'M4A/MP4' }
  // WMA / ASF
  if (
    buf[0] === 0x30 &&
    buf[1] === 0x26 &&
    buf[2] === 0xb2 &&
    buf[3] === 0x75
  ) {
    return { ext: 'wma', label: 'WMA' }
  }
  // AIFF
  if (ascii(0, 4) === 'FORM') return { ext: 'aiff', label: 'AIFF' }

  return null
}

/**
 * 给一个「不是音频」的文件做体检描述，用在报错信息里。
 * 直接把开头几十字节摆出来，用户和我们都能一眼看出下到的是什么。
 */
export function describeNonAudio(buf: Buffer): string {
  if (!buf || buf.length === 0) return '文件是空的'

  const head = buf.toString('latin1', 0, Math.min(80, buf.length))
  const printable = head.replace(/[^\x20-\x7e\u4e00-\u9fff]/g, '.')

  if (/^\s*</.test(head)) return `下到的是一段网页而不是音频：${printable.slice(0, 60)}`
  if (/^\s*[\[{]/.test(head)) return `下到的是一段 JSON 而不是音频：${printable.slice(0, 60)}`
  return `文件头不是任何已知音频格式，开头是：${printable.slice(0, 60)}`
}

/** 扩展名与真实格式不符时给出提示（不阻止，只提醒） */
export function extMismatch(ext: string, format: AudioFormat | null): string | null {
  if (!format) return null
  const want = ext.toLowerCase().replace('.', '')
  if (want === format.ext) return null
  // mp4/m4a/aac 算一家人，别互相报错
  const mp4Family = ['m4a', 'mp4', 'aac']
  if (mp4Family.includes(want) && mp4Family.includes(format.ext)) return null
  return `扩展名是 .${want}，实际是 ${format.label}`
}
