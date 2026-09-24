/** 把 COMM 帧的字节摊开看 */
import { readFileSync } from 'node:fs'

const SRC = process.argv[2] || 'C:\\Users\\18509\\Desktop\\歌曲下载\\Corbon Amodio - lucy~.mp3'
const buf = readFileSync(SRC)
const syncsafe = (b) => ((b[0] & 0x7f) << 21) | ((b[1] & 0x7f) << 14) | ((b[2] & 0x7f) << 7) | (b[3] & 0x7f)
const u32 = (b) => ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0

const tagEnd = 10 + syncsafe(buf.subarray(6, 10))
let p = 10
while (p + 10 <= tagEnd) {
  const id = buf.toString('ascii', p, p + 4)
  if (!/^[A-Z0-9]{4}$/.test(id)) break
  const size = u32(buf.subarray(p + 4, p + 8))
  const dataStart = p + 10
  const data = buf.subarray(dataStart, dataStart + size)

  if (id === 'COMM' || id === 'TIT2' || id === 'TPE1') {
    console.log(`\n=== ${id}  数据 ${size} 字节 @${dataStart} ===`)
    console.log(`十六进制: ${data.toString('hex').replace(/(..)/g, '$1 ').trim()}`)
    const enc = data[0]
    console.log(`编码字节: ${enc}  (0=Latin1 1=UTF-16+BOM 2=UTF-16BE 3=UTF-8)`)
    if (id === 'COMM') {
      console.log(`语言: "${data.toString('ascii', 1, 4)}"  (3 字节 ISO-639-2)`)
      let q = 4
      // 描述串
      const descStart = q
      if (enc === 1 || enc === 2) {
        // 每 2 字节一个码位，遇到 00 00 结束
        while (q + 1 < data.length && !(data[q] === 0 && data[q + 1] === 0)) q += 2
        console.log(`描述串(UTF-16) 字节 ${descStart}..${q} = ${data.subarray(descStart, q).toString('hex')}`)
        console.log(`  BOM: ${data.subarray(descStart, descStart + 2).toString('hex')}  (fffe=UTF-16LE, feff=UTF-16BE)`)
        q += 2 // 跳过 00 00
      } else {
        while (q < data.length && data[q] !== 0) q += 1
        console.log(`描述串(Latin1) 字节 ${descStart}..${q} = "${data.toString('latin1', descStart, q)}"`)
        q += 1
      }
      const textStart = q
      const textEnd = data.length
      console.log(`正文起点: ${textStart}  剩余 ${textEnd - textStart} 字节`)
      if (enc === 1) {
        console.log(`  首两字节(BOM): ${data.subarray(textStart, textStart + 2).toString('hex')}`)
        console.log(`  正文: "${data.subarray(textStart + 2).toString('utf16le')}"`)
      } else {
        console.log(`  正文: "${data.toString('utf8', textStart)}"`)
      }
    } else {
      if (enc === 1) {
        console.log(`BOM: ${data.subarray(1, 3).toString('hex')}`)
        console.log(`文本: "${data.subarray(3).toString('utf16le').replace(/\0/g, '')}"`)
      } else {
        console.log(`文本: "${data.subarray(1).toString('utf8').replace(/\0/g, '')}"`)
      }
    }
  }
  p = dataStart + size
}
