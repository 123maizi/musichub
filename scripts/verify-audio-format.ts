/**
 * 内容校验逻辑自测。
 * 这是「下载到错误页却被当成成功」的防线，逻辑必须准。
 */
import { describeNonAudio, extMismatch, sniffAudioFormat } from '../src/main/core/download/audio-format'

const cases: { label: string; buf: Buffer; expectAudio: boolean }[] = [
  { label: '正常 MP3（带 ID3）', buf: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(20)]), expectAudio: true },
  { label: '正常 MP3（裸帧）', buf: Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(20)]), expectAudio: true },
  { label: '正常 FLAC', buf: Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(20)]), expectAudio: true },
  { label: '正常 M4A', buf: Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(20)]), expectAudio: true },
  { label: '正常 OGG', buf: Buffer.concat([Buffer.from('OggS'), Buffer.alloc(20)]), expectAudio: true },
  { label: 'HTML 错误页', buf: Buffer.from('<!DOCTYPE html><html><head><title>403 Forbidden</title>'), expectAudio: false },
  { label: 'JSON 错误', buf: Buffer.from('{"code":403,"msg":"no permission to play"}'), expectAudio: false },
  { label: '空文件', buf: Buffer.alloc(0), expectAudio: false },
  { label: '太短', buf: Buffer.from([0xff, 0xfb]), expectAudio: false },
  { label: '纯文本', buf: Buffer.from('Not Found - the resource is unavailable'), expectAudio: false }
]

console.log('\n音频格式识别自测')
console.log('='.repeat(70))
let pass = 0
for (const c of cases) {
  const fmt = sniffAudioFormat(c.buf)
  const ok = Boolean(fmt) === c.expectAudio
  if (ok) pass += 1
  console.log(
    `  ${ok ? '✓' : '✗'} ${c.label.padEnd(20)} → ${fmt ? fmt.label : '不是音频'}${ok ? '' : '   ✗ 判断错了！'}`
  )
  if (!fmt && c.label.startsWith('HTML')) console.log(`      报错文案: ${describeNonAudio(c.buf)}`)
  if (!fmt && c.label.startsWith('JSON')) console.log(`      报错文案: ${describeNonAudio(c.buf)}`)
}

console.log('\n扩展名不符检测')
console.log('='.repeat(70))
const mismatchCases: [string, string, boolean][] = [
  ['mp3', 'MP3', false],
  ['flac', 'FLAC', false],
  ['m4a', 'M4A/MP4', false],
  ['mp3', 'FLAC', true],
  ['flac', 'MP3', true]
]
for (const [ext, label, shouldWarn] of mismatchCases) {
  const fake = { ext: label.includes('FLAC') ? 'flac' : label.includes('M4A') ? 'm4a' : 'mp3', label }
  const msg = extMismatch(ext, fake)
  const ok = Boolean(msg) === shouldWarn
  if (ok) pass += 1
  console.log(`  ${ok ? '✓' : '✗'} .${ext} vs ${label.padEnd(8)} → ${msg ?? '一致'}`)
}

console.log(`\n共 ${cases.length + mismatchCases.length} 项，通过 ${pass}`)
console.log('='.repeat(70))
