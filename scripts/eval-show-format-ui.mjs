/* 把界面停在下载页并展开格式选择区，方便截图 */
window.location.hash = '#/downloads'
await new Promise((r) => setTimeout(r, 2600))
const block = document.querySelector('.format-block')
if (block) block.scrollIntoView({ block: 'start' })
await new Promise((r) => setTimeout(r, 500))
return JSON.stringify({
  页面: location.hash,
  格式区可见: Boolean(block),
  按钮: [...document.querySelectorAll('.fmt .opt')].map((b) => b.innerText.replace(/\s+/g, ' ').trim())
})
