/**
 * 大图地址形态实测：对每个平台把「尺寸段替换」的候选都请求一遍，
 * 看 HTTP 状态、字节数、真实像素尺寸。只有实测变大的才写进正则 —— 猜是没用的。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/** 从字节里读 JPEG / PNG / WEBP 的真实宽高 */
function dimensions(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), kind: 'png' }
  }
  if (buf.length > 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, kind: 'webp' }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue }
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), kind: 'jpg' }
      }
      i += 2 + len
    }
    return { w: 0, h: 0, kind: 'jpg?' }
  }
  return { w: 0, h: 0, kind: (buf.toString('latin1', 0, 12).match(/^[\x20-\x7e]+/) ?? ['?'])[0].slice(0, 12) }
}

async function probe(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: new URL(url).origin + '/' } })
    const buf = Buffer.from(await r.arrayBuffer())
    const d = dimensions(buf)
    return `HTTP ${r.status} ${buf.length}B ${d.w}x${d.h} ${d.kind}`
  } catch (e) {
    return `ERR ${e.message.slice(0, 50)}`
  }
}

const CASES = [
  {
    label: '酷我 /star/albumcover/{n}/',
    variants: [
      'https://img2.kuwo.cn/star/albumcover/120/47/9/1372912414.jpg',
      'https://img2.kuwo.cn/star/albumcover/500/47/9/1372912414.jpg',
      'https://img2.kuwo.cn/star/albumcover/1000/47/9/1372912414.jpg'
    ]
  },
  {
    label: '酷狗 stdmusic/{n}/',
    variants: [
      'http://imge.kugou.com/stdmusic/240/20230920/20230920142503632013.jpg',
      'http://imge.kugou.com/stdmusic/800/20230920/20230920142503632013.jpg',
      'http://imge.kugou.com/stdmusic/1000/20230920/20230920142503632013.jpg'
    ]
  },
  {
    label: '酷狗 singerimg softhead/{n}/',
    variants: [
      'http://singerimg.kugou.com/uploadpic/softhead/300/20260324/20260324001005938692.jpg',
      'http://singerimg.kugou.com/uploadpic/softhead/500/20260324/20260324001005938692.jpg'
    ]
  },
  {
    label: '腾讯 T002R{n}x{n}M000',
    variants: [
      'https://y.gtimg.cn/music/photo_new/T002R300x300M000000MkMni19ClKG.jpg',
      'https://y.gtimg.cn/music/photo_new/T002R500x500M000000MkMni19ClKG.jpg',
      'https://y.gtimg.cn/music/photo_new/T002R800x800M000000MkMni19ClKG.jpg'
    ]
  },
  {
    label: '网易云 ?param={n}y{n}',
    variants: [
      'https://p3.music.126.net/yHSA9LZi2-Qn_I20wHGwYg==/109951165959446600.jpg?param=300y300',
      'https://p3.music.126.net/yHSA9LZi2-Qn_I20wHGwYg==/109951165959446600.jpg?param=500y500',
      'https://p3.music.126.net/yHSA9LZi2-Qn_I20wHGwYg==/109951165959446600.jpg?param=1024y1024',
      'https://p3.music.126.net/yHSA9LZi2-Qn_I20wHGwYg==/109951165959446600.jpg'
    ]
  },
  {
    label: '咪咕 /resource/{n}/',
    variants: [
      'https://d.musicapp.migu.cn/data/oss/resource/00/5u/7q/959ba4e19cf64d488f1f623f95892bf2.webp',
      'https://d.musicapp.migu.cn/data/oss/resource/300/5u/7q/959ba4e19cf64d488f1f623f95892bf2.webp',
      'https://d.musicapp.migu.cn/data/oss/resource/500/5u/7q/959ba4e19cf64d488f1f623f95892bf2.webp'
    ]
  }
]

for (const c of CASES) {
  console.log(`\n===== ${c.label} =====`)
  for (const u of c.variants) {
    console.log(`  ${await probe(u)}   <- ${u.slice(0, 96)}`)
  }
}
