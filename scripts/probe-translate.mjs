/**
 * 免费翻译接口备选探测
 *
 * 起因：MyMemory 匿名额度按 IP 算，被跑测试用光了，今天就再也翻不动了。
 * 所以来看还有哪些「不需要 key、不需要账号」的接口可用。
 */

const text = 'Imagine there’s no heaven'

const candidates = [
  {
    name: 'MyMemory（现用）',
    url: `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`,
    pick: (b) => b?.responseData?.translatedText
  },
  {
    name: 'Google gtx（非官方）',
    url: `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`,
    pick: (b) => (Array.isArray(b?.[0]) ? b[0].map((s) => s[0]).join('') : null)
  },
  {
    name: 'Google gtx 备用域',
    url: `https://translate.google.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`,
    pick: (b) => (Array.isArray(b?.[0]) ? b[0].map((s) => s[0]).join('') : null)
  },
  {
    name: 'LibreTranslate (astian)',
    url: 'https://translate.astian.org/translate',
    post: { q: text, source: 'en', target: 'zh', format: 'text' },
    pick: (b) => b?.translatedText
  },
  {
    name: 'LibreTranslate (.de)',
    url: 'https://libretranslate.de/translate',
    post: { q: text, source: 'en', target: 'zh', format: 'text' },
    pick: (b) => b?.translatedText
  },
  {
    name: 'LibreTranslate (com)',
    url: 'https://libretranslate.com/translate',
    post: { q: text, source: 'en', target: 'zh', format: 'text' },
    pick: (b) => b?.translatedText
  },
  {
    name: 'Bing 免密（非官方）',
    url: `https://cn.bing.com/ttranslatev3?isVertical=1&fromLang=en&to=zh-Hans`,
    post: `fromLang=en&text=${encodeURIComponent(text)}&to=zh-Hans`,
    form: true,
    pick: (b) => b?.[0]?.translations?.[0]?.text
  }
]

console.log(`\n翻译接口探测（目标：不需要 key、不需要账号）\n${'='.repeat(72)}`)

for (const c of candidates) {
  const started = Date.now()
  try {
    const res = await fetch(c.url, {
      method: c.post ? 'POST' : 'GET',
      headers: c.form
        ? { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }
        : c.post
          ? { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }
          : { 'User-Agent': 'MusicHub/1.0.5' },
      body: c.post ? (c.form ? c.post : JSON.stringify(c.post)) : undefined,
      signal: AbortSignal.timeout(12000)
    })
    const raw = await res.text()
    let body = null
    try {
      body = JSON.parse(raw)
    } catch {
      body = raw
    }
    const out = c.pick(body)
    const cost = Date.now() - started
    if (out && typeof out === 'string' && out.trim()) {
      console.log(`  ✓ ${c.name.padEnd(22)} HTTP ${res.status}  ${cost}ms`)
      console.log(`      → ${out.slice(0, 80)}`)
    } else {
      console.log(`  ✗ ${c.name.padEnd(22)} HTTP ${res.status}  ${cost}ms  无有效译文`)
      console.log(`      ${String(raw).replace(/\s+/g, ' ').slice(0, 110)}`)
    }
  } catch (err) {
    console.log(`  ✗ ${c.name.padEnd(22)} 失败: ${String(err.message).slice(0, 90)}`)
  }
}

console.log(`${'='.repeat(72)}\n`)
