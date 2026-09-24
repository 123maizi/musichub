/**
 * 摸清酷我搜索接口的封面字段。
 * 换上酷狗的正确字段后，酷我从 38% 掉成了最差的一个，得查清楚。
 */
import { writeFileSync } from 'node:fs'

const kw = '周杰伦'
const url =
  `http://search.kuwo.cn/r.s?all=${encodeURIComponent(kw)}` +
  `&ft=music&itemset=web_2013&client=kt&pn=0&rn=20&rformat=json&encoding=utf8`

const res = await fetch(url, {
  headers: { Referer: 'http://www.kuwo.cn/', 'User-Agent': 'Mozilla/5.0', Cookie: 'kw_token=ABCDEFGHIJKLMNOP' }
})
const text = await res.text()

/* 用宽松解析（跟应用里那条路一致） */
function parseLooseJson(t) {
  let out = ''
  let i = 0
  let inString = false
  let quote = ''
  while (i < t.length) {
    const ch = t[i]
    if (!inString) {
      if (ch === "'" || ch === '"') {
        inString = true
        quote = ch
        out += '"'
        i += 1
        continue
      }
      out += ch
      i += 1
      continue
    }
    if (ch === '\\') {
      const next = t[i + 1]
      if (next === "'") {
        out += "'"
        i += 2
        continue
      }
      if (next === '"') {
        out += '\\"'
        i += 2
        continue
      }
      out += ch + (next ?? '')
      i += 2
      continue
    }
    if (ch === quote) {
      inString = false
      out += '"'
      i += 1
      continue
    }
    if (quote === "'" && ch === '"') {
      out += '\\"'
      i += 1
      continue
    }
    out += ch
    i += 1
  }
  return JSON.parse(out.replace(/,\s*([}\]])/g, '$1'))
}

const body = parseLooseJson(text)
const list = body.abslist ?? []

console.log(`\n酷我搜索返回 ${list.length} 条`)
console.log('='.repeat(76))

/* 统计每个条目里所有含 pic/img/cover 的字段 */
const fieldStats = new Map()
for (const item of list) {
  for (const [k, v] of Object.entries(item)) {
    if (/pic|img|cover|photo/i.test(k)) {
      const val = String(v ?? '')
      const acc = fieldStats.get(k) ?? { nonEmpty: 0, sample: '' }
      if (val.trim()) {
        acc.nonEmpty += 1
        if (!acc.sample) acc.sample = val.slice(0, 80)
      }
      fieldStats.set(k, acc)
    }
  }
}

console.log('图片相关字段的填充率：')
if (fieldStats.size === 0) console.log('  （没有任何图片字段）')
for (const [k, acc] of fieldStats) {
  console.log(`  ${k.padEnd(24)} ${acc.nonEmpty}/${list.length} 填充   例: ${acc.sample}`)
}

console.log('\n前 8 条的 albumid 与封面字段：')
for (const item of list.slice(0, 8)) {
  console.log(
    `  ${String(item.SONGNAME).slice(0, 16).padEnd(18)} ALBUMID=${String(item.ALBUMID).padEnd(10)} web_albumpic_short="${String(item.web_albumpic_short ?? '')}"`
  )
}

/* 试着用 albumid 直接拼封面 */
console.log('\n试几种「只用 albumid 就能拿到封面」的地址：')
const sample = list.find((x) => String(x.ALBUMID ?? '') && String(x.ALBUMID) !== '0')
if (sample) {
  const id = String(sample.ALBUMID)
  const candidates = [
    ['kuwo albumcover/500 (albumid)', `https://img2.kuwo.cn/star/albumcover/500/${id}.jpg`],
    ['kuwo albumcover/500 无扩展', `https://img2.kuwo.cn/star/albumcover/500/${id}`],
    ['player.kuwo.cn getPic', `http://player.kuwo.cn/webmusic/st/getPic?albumid=${id}`],
    ['kuwo album cover api', `http://www.kuwo.cn/api/www/album/albumInfo?albumId=${id}&rn=1&pn=1`]
  ]
  for (const [label, u] of candidates) {
    try {
      const r = await fetch(u, {
        headers: { Referer: 'http://www.kuwo.cn/', 'User-Agent': 'Mozilla/5.0', Cookie: 'kw_token=ABCDEFGHIJKLMNOP' }
      })
      const buf = Buffer.from(await r.arrayBuffer())
      const isJpg = buf[0] === 0xff && buf[1] === 0xd8
      const isPng = buf[0] === 0x89 && buf[1] === 0x50
      console.log(
        `  ${label.padEnd(30)} HTTP ${r.status}  ${(buf.length / 1024).toFixed(1)}KB  ${isJpg ? 'JPEG' : isPng ? 'PNG' : '非图片'}`
      )
    } catch (e) {
      console.log(`  ${label.padEnd(30)} 失败: ${e.message.slice(0, 60)}`)
    }
  }
}
console.log('='.repeat(76))
