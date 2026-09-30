/**
 * 路由视图不切换的定位探针（task-8，一次性，高优先）
 *
 * 现象：hash 变了、外壳顶栏标题也跟着变了（说明路由状态本身更新了），
 * 但 `main` 里的视图一直是搜索页 —— 换页等于没换。
 *
 * 最可能的原因：App.vue 的 `<Transition name="route" mode="out-in">` 里，
 * **离开过渡一直不结束**。out-in 的语义是「旧的退完才挂新的」，
 * 一旦离开钩子不 resolve，新视图永远不会进来，DOM 就停在旧页面上。
 *
 * 所以这里直接把「正在跑的动画/过渡」摊开看：
 *   · document.getAnimations() —— 有没有卡住的 transition/animation
 *   · main > * 的真实身份（把 outerHTML 前 200 字带回来）
 *   · 该元素的 transition-duration / animation-duration 实际算出来是多少
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { steps: {} }

function viewInfo(tag) {
  const main = document.querySelector('main')
  const child = main ? main.children[0] : null
  const cs = child ? getComputedStyle(child) : null
  const anims = (document.getAnimations ? document.getAnimations() : []).map((a) => ({
    kind: a.constructor.name,
    state: a.playState,
    dur: a.effect && a.effect.getTiming ? a.effect.getTiming().duration : null,
    target: a.effect && a.effect.target ? String(a.effect.target.className).slice(0, 40) : null
  }))
  return {
    tag,
    hash: location.hash,
    childCount: main ? main.children.length : -1,
    childClass: child ? String(child.className) : null,
    childHtml: child ? String(child.outerHTML).replace(/\s+/g, ' ').slice(0, 200) : null,
    childTransition: cs ? cs.transitionProperty + ' / ' + cs.transitionDuration : null,
    childAnimation: cs ? cs.animationName + ' / ' + cs.animationDuration : null,
    childOpacity: cs ? cs.opacity : null,
    childTransform: cs ? cs.transform : null,
    animations: anims,
    hasSettingsText: (document.body.innerText || '').includes('AI 歌词翻译'),
    hasDownloadsText: (document.body.innerText || '').includes('还没有下载任务') ||
      (document.body.innerText || '').includes('下载格式')
  }
}

out.steps.initial = viewInfo('初始')

// 真实路径：点导航柱的「设置」
const btn = [...document.querySelectorAll('.nav-item')].find((b) => (b.getAttribute('aria-label') || '') === '设置')
out.steps.foundSettingsBtn = Boolean(btn)
if (btn) btn.click()

for (const wait of [200, 600, 1200, 2500, 5000]) {
  await sleep(wait === 200 ? 200 : wait - (wait === 600 ? 200 : wait === 1200 ? 600 : wait === 2500 ? 1200 : 2500))
  out.steps['after' + wait + 'ms'] = viewInfo('点设置后 ' + wait + 'ms')
}

return out
