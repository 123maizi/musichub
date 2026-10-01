/** 诊断：SearchHistoryDropdown 的 props / 内部状态为什么没开 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $ = (s) => document.querySelector(s)

function findComponent(instance, name, depth = 0, seen = new Set()) {
  if (!instance || seen.has(instance) || depth > 40) return null
  seen.add(instance)
  const type = instance.type
  const cname = type?.__name || type?.name || ''
  if (cname === name) return instance
  const kids = instance.subTree ? [instance.subTree] : []
  const stack = [...kids]
  while (stack.length) {
    const vnode = stack.pop()
    if (!vnode || typeof vnode !== 'object') continue
    if (vnode.component) {
      const found = findComponent(vnode.component, name, depth + 1, seen)
      if (found) return found
    }
    if (Array.isArray(vnode.children)) stack.push(...vnode.children)
    if (vnode.shapeFlag && vnode.children && typeof vnode.children === 'object' && vnode.children.default) {
      try {
        const c = vnode.children.default()
        if (Array.isArray(c)) stack.push(...c)
      } catch {
        /* ignore */
      }
    }
  }
  return null
}

const app = $('#app').__vue_app__
const root = app._instance
const inst = findComponent(root, 'SearchHistoryDropdown')
const out = { found: !!inst }
if (inst) {
  out.props = {
    visible: inst.props.visible,
    query: inst.props.query,
    hasAnchor: !!inst.props.anchor,
    maxVisible: inst.props.maxVisible
  }
  out.debug = inst.exposed?.debugState?.value ?? inst.exposed?.debugState ?? null
  out.internalHistory = inst.setupState?.history ?? null
}

/* 再走一遍父组件路径：模拟聚焦，看 visible 有没有变 */
const input = $('.search-box input')
out.beforeFocus = {
  activeElement: document.activeElement?.tagName ?? null,
  hasFocus: document.hasFocus(),
  popPresent: !!$('.history-pop')
}
input.focus()
await sleep(600)
const inst2 = findComponent(app._instance, 'SearchHistoryDropdown')
out.afterFocus = {
  activeElement: document.activeElement?.tagName ?? null,
  activeIsInput: document.activeElement === input,
  popPresent: !!$('.history-pop'),
  propsVisible: inst2?.props?.visible ?? null,
  debug: inst2?.exposed?.debugState?.value ?? null,
  internalHistory: inst2?.setupState?.history ?? null,
  prefsHistory: (await window.api.prefs.get()).searchHistory
}
return out
