/** 验证「现成官方翻译」功能：选项出现、能自动应用、能切换 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}

const rail = (l) =>
  [...document.querySelectorAll('.rail .nav-item')].find((x) =>
    (x.querySelector('.nav-label')?.textContent ?? '').includes(l)
  )
const rows = () => [...document.querySelectorAll('.results .row')]

rail('搜索')?.click()
await sleep(2000)

// 搜一首确定有官方中文翻译的英文歌
const inp = document.querySelector('.search-box input')
inp.focus()
inp.value = ''
inp.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(250)
inp.value = 'Shape of You'
inp.dispatchEvent(new Event('input', { bubbles: true }))
await sleep(250)
inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
for (let i = 0; i < 25; i += 1) {
  await sleep(1000)
  if (rows().length > 0) break
}
out.结果行数 = rows().length
if (!rows().length) return JSON.stringify(out, null, 1)
out.首条 = (rows()[0].querySelector('.title')?.textContent ?? '').trim().slice(0, 20)

rows()[0].querySelector('.col-actions button[title="播放"]')?.click()
await sleep(3000)
location.hash = '#/now-playing'
for (let i = 0; i < 25; i += 1) {
  await sleep(600)
  if (document.querySelector('.lyric-line')) break
}
// 给「收集官方翻译」留时间（两次网络请求）
await sleep(9000)

const pickLabel = document.querySelector('.trans-pick-label')
const pickBtns = [...document.querySelectorAll('.lyric-bar .translate-btn')].filter((b) =>
  /QQ音乐|网易云/.test(b.textContent ?? '')
)
out.现成译文 = {
  分组标签存在: !!pickLabel,
  标签文字: pickLabel ? pickLabel.textContent.trim() : null,
  选项: pickBtns.map((b) => ({
    文字: b.textContent.trim(),
    已选中: b.classList.contains('on'),
    提示: (b.getAttribute('title') ?? '').slice(0, 30)
  }))
}
out.全部按钮 = [...document.querySelectorAll('.lyric-bar .translate-btn')].map((b) => b.textContent.trim())

// 歌词行数 + 是否有译文行
const lines = [...document.querySelectorAll('.lyric-line')]
out.歌词 = {
  行数: lines.length,
  首行文本: lines[0] ? lines[0].innerText.replace(/\s+/g, ' ').trim().slice(0, 50) : null,
  首行结构: lines[0] ? [...lines[0].querySelectorAll('*')].map((e) => e.tagName + '.' + (typeof e.className === 'string' ? e.className : '')).slice(0, 4) : null,
  含译文的行数: lines.filter((l) => l.innerText.trim().split('\n').length > 1).length
}

// 点第二个选项（如果有），看会不会切换
if (pickBtns.length > 1) {
  pickBtns[1].click()
  await sleep(1200)
  out.切换后 = {
    已选中: [...document.querySelectorAll('.lyric-bar .translate-btn')]
      .filter((b) => b.classList.contains('on'))
      .map((b) => b.textContent.trim()),
    含译文的行数: [...document.querySelectorAll('.lyric-line')].filter(
      (l) => l.innerText.trim().split('\n').length > 1
    ).length
  }
}

return JSON.stringify(out, null, 1)
