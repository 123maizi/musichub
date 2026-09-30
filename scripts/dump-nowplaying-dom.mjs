/** 看看播放页到底渲染了什么 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

window.location.hash = '#/now-playing'
await sleep(5000)

const right = document.querySelector('.right')
const view = document.querySelector('.view')

return JSON.stringify(
  {
    当前hash: location.hash,
    有view容器: Boolean(view),
    view的class: view ? view.className : null,
    右侧区存在: Boolean(right),
    右侧区HTML片段: right ? right.innerHTML.replace(/\s+/g, ' ').slice(0, 500) : null,
    页面文本片段: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400),
    各类选择器命中数: {
      'lyric-box': document.querySelectorAll('.lyric-box').length,
      'lyric-line': document.querySelectorAll('.lyric-line').length,
      'lyric-empty': document.querySelectorAll('.lyric-empty').length,
      'translate-btn': document.querySelectorAll('.translate-btn').length,
      'stage': document.querySelectorAll('.stage').length
    }
  },
  null,
  1
)

