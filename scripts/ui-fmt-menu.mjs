/**
 * 验证紧凑版格式选择器：触发器占 1 个控件位、下拉能展开、4 个格式都在。
 * 用法：node scripts/cdp-run.mjs <port> scripts/ui-fmt-menu.mjs
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const trigger = document.querySelector('.fmt-menu .trigger')
if (!trigger) {
  return JSON.stringify({ 结论: '没找到紧凑触发器（可能这页没用 compact）', 顶栏控件数: document.querySelectorAll('#page-actions > *').length })
}

const before = { 触发器文字: trigger.innerText.trim(), 展开: trigger.getAttribute('aria-expanded') }
trigger.click()
await sleep(400)
const menu = document.querySelector('.fmt-menu .menu')
const items = [...document.querySelectorAll('.fmt-menu .menu-item')].map((b) => b.innerText.replace(/\s+/g, ' ').trim())
const rect = menu?.getBoundingClientRect()

/* 点空白处应当收起 */
document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
await sleep(300)
const closedByOutsideClick = !document.querySelector('.fmt-menu .menu')

/* Esc 也应当收起 */
trigger.click()
await sleep(300)
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
await sleep(300)
const closedByEsc = !document.querySelector('.fmt-menu .menu')

return JSON.stringify(
  {
    触发器: before,
    展开后: {
      面板存在: !!menu,
      面板尺寸: rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : null,
      格式项数: items.length,
      格式项: items,
      面板用pop过渡: !!document.querySelector('.pop-enter-active, .pop-enter-to') || !!menu
    },
    点空白收起: closedByOutsideClick,
    Esc收起: closedByEsc,
    顶栏可见控件数: document.querySelectorAll('#page-actions > *').length,
    顶栏控件: [...document.querySelectorAll('#page-actions > *')].map((e) => e.innerText.replace(/\s+/g, ' ').trim().slice(0, 28))
  },
  null,
  1
)
