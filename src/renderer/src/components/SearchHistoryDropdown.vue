<script setup lang="ts">
/**
 * 搜索历史下拉
 *
 * 为什么做成独立组件（而不是塞进 SearchView）：
 * 搜索框那一带归 render-perf 改，历史下拉是一个完整、独立、可自测的小件 ——
 * 放成组件两边都不打架，也方便单测（scripts/ui-probe-search-history.mjs）。
 *
 * 用法（父组件只需挂一行 + 在真正发起搜索处记一笔）：
 *
 *   <SearchHistoryDropdown
 *     :visible="showHistory"
 *     :query="keyword"
 *     :anchor="inputEl"
 *     @pick="runSearch"          // 收到关键词 → 用它发起搜索
 *     @close="showHistory = false"
 *   />
 *   // 真正发起一次搜索之后：
 *   void window.api.prefs.addSearchHistory(keyword)
 *
 * 组件自己负责：读历史、过滤、键盘 ↑↓ Enter Esc、点外关闭、单条删除、清空全部。
 * 父组件只决定「什么时候展开」（典型：输入框聚焦 且 输入为空或无结果）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { SEARCH_HISTORY_VISIBLE } from '@shared/types/preferences'

const props = withDefaults(
  defineProps<{
    /** 是否展开（由父组件根据「聚焦 + 空态」决定） */
    visible?: boolean
    /** 当前输入内容：非空时按它过滤历史 */
    query?: string
    /** 搜索框元素：用于「点外面关闭」判定与浮层定位 */
    anchor?: HTMLElement | null
    /** 一次最多显示几条 */
    maxVisible?: number
  }>(),
  { visible: false, query: '', anchor: null, maxVisible: SEARCH_HISTORY_VISIBLE }
)

const emit = defineEmits<{
  (e: 'pick', keyword: string): void
  (e: 'close'): void
}>()

const history = ref<string[]>([])
const loading = ref(false)
const loadError = ref('')
/** 诊断：reload 被调了几次、拿回来的原始值是什么（验证时靠它定位，不影响功能） */
const reloadCount = ref(0)
const rawSeen = ref('')
const activeIndex = ref(-1)
const rootEl = ref<HTMLElement | null>(null)

/** 非空输入时按包含匹配过滤；空输入显示全部 */
const items = computed(() => {
  const q = (props.query ?? '').trim().toLowerCase()
  const list = q ? history.value.filter((w) => w.toLowerCase().includes(q)) : history.value
  return list.slice(0, props.maxVisible)
})

/** 有内容才展开：过滤后为空时不该糊一个空壳浮层在输入框下面 */
const open = computed(() => props.visible && !loading.value && items.value.length > 0)

async function reload(): Promise<void> {
  reloadCount.value += 1
  try {
    loading.value = true
    loadError.value = ''
    const prefs = await window.api.prefs.get()
    rawSeen.value = String(JSON.stringify(prefs)).slice(0, 120)
    history.value = Array.isArray(prefs?.searchHistory) ? prefs.searchHistory : []
  } catch (err) {
    // 读不到历史就当作没有：绝不能因为它把搜索框弄坏。
    // 但要把原因留下来 —— 否则「历史永远是空的」这种问题无从查起。
    loadError.value = err instanceof Error ? err.message : String(err)
    history.value = []
  } finally {
    loading.value = false
  }
}

/** 供父组件调用：真正发起搜索后记一笔（也可以直接 window.api.prefs.addSearchHistory） */
async function record(keyword: string): Promise<void> {
  const word = String(keyword ?? '').trim()
  if (!word) return
  try {
    history.value = await window.api.prefs.addSearchHistory(word)
  } catch {
    /* 记录失败不影响搜索本身 */
  }
}

function pick(index: number): void {
  const word = items.value[index]
  if (!word) return
  activeIndex.value = -1
  emit('pick', word)
  // 点选后把它提到最前，下次打开就在第一条
  void record(word)
}

async function removeItem(keyword: string, event: Event): Promise<void> {
  event.stopPropagation()
  try {
    history.value = await window.api.prefs.removeSearchHistory(keyword)
  } catch {
    /* 删不掉就保持原样 */
  }
  if (activeIndex.value >= items.value.length) activeIndex.value = items.value.length - 1
}

async function clearAll(event: Event): Promise<void> {
  event.stopPropagation()
  try {
    history.value = await window.api.prefs.clearSearchHistory()
  } catch {
    /* 同上 */
  }
  activeIndex.value = -1
  emit('close')
}

/* ------------------------------ 键盘 ------------------------------ */

/**
 * 键盘事件挂在 window 上（capture 阶段）。
 *
 * 原因：焦点始终留在父组件的搜索框里（这才是 combobox 的正确形态，用户不该
 * 为了按 ↓ 先把焦点挪到浮层上）。所以组件必须能拦到输入框上的按键。
 * 只在展开时拦截，且只在「确实处理了」时才 preventDefault ——
 * 输入框为空、没有高亮项时按 Enter，要能照常触发父组件自己的搜索。
 */
function onKeydown(event: KeyboardEvent): void {
  if (!open.value) return
  const key = event.key
  if (key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % items.value.length
    return
  }
  if (key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = activeIndex.value <= 0 ? items.value.length - 1 : activeIndex.value - 1
    return
  }
  if (key === 'Enter') {
    if (activeIndex.value >= 0) {
      // 有高亮项：这次回车归下拉，父组件的搜索不再触发
      event.preventDefault()
      event.stopPropagation()
      pick(activeIndex.value)
    }
    return
  }
  if (key === 'Escape') {
    event.preventDefault()
    activeIndex.value = -1
    emit('close')
  }
}

/* ------------------------------ 点外关闭 ------------------------------ */

function onPointerDown(event: PointerEvent): void {
  if (!open.value) return
  const target = event.target as Node | null
  if (!target) return
  if (rootEl.value?.contains(target)) return
  if (props.anchor && (props.anchor === target || props.anchor.contains(target))) return
  emit('close')
}

/* ------------------------------ 浮层定位 ------------------------------ */

/**
 * 用 fixed + 锚点 rect 定位。
 *
 * 为什么不直接 absolute 贴父容器：外壳 `.page` 有 `overflow: hidden`，
 * absolute 的浮层会被裁掉；fixed 不受祖先 overflow 影响（只要祖先没有 transform）。
 * 搜索框在页面上方，浮层往下展开，不需要翻转到上方。
 */
const boxStyle = ref<Record<string, string>>({})

function reposition(): void {
  const anchor = props.anchor
  if (!anchor) {
    // 没有锚点就退化成「贴父容器」——父容器需要自己 position: relative
    boxStyle.value = {}
    return
  }
  const r = anchor.getBoundingClientRect()
  boxStyle.value = {
    left: `${Math.round(r.left)}px`,
    top: `${Math.round(r.bottom + 6)}px`,
    width: `${Math.round(r.width)}px`
  }
}

watch(
  () => [open.value, props.anchor] as const,
  () => {
    if (open.value) reposition()
  }
)

/* ------------------------------ 数据加载 ------------------------------ */

/**
 * 什么时候重新读历史 —— 这里踩过一个真坑，记下来：
 *
 * 只监听 `visible` 的**变化**是不够的。父组件的展开入口是
 * `@focus/@click/@input="openHistory"`，而它做的是 `showHistory.value = true`；
 * 如果这个值**已经是 true**（例如应用启动时搜索框就被自动聚焦、面板一直开着），
 * 再点一次搜索框不会产生任何变化 → watch 不触发 → 列表停留在上一次读到的内容。
 * 表现出来就是：「聚焦了、面板也开着，但历史是空的/是旧的」。
 *
 * 所以除了 watch，还直接盯住**锚点自身**的 focus / click —— 那才是「用户想看历史了」
 * 的真实信号，与父组件的状态机无关。不监听 input：那是每次键入都会触发的，
 * 而键入只影响客户端过滤，不会产生新的历史条目，没必要每次都打一次 IPC。
 */
let anchorEl: HTMLElement | null = null
const onAnchorIntent = (): void => {
  void reload()
}

function attachAnchor(el: HTMLElement | null): void {
  detachAnchor()
  if (!el) return
  anchorEl = el
  el.addEventListener('focus', onAnchorIntent)
  el.addEventListener('click', onAnchorIntent)
}

function detachAnchor(): void {
  if (!anchorEl) return
  anchorEl.removeEventListener('focus', onAnchorIntent)
  anchorEl.removeEventListener('click', onAnchorIntent)
  anchorEl = null
}

watch(
  () => props.anchor,
  (el) => attachAnchor(el ?? null),
  { immediate: true }
)

watch(
  () => props.visible,
  (v) => {
    if (v) {
      activeIndex.value = -1
      void reload()
    } else {
      activeIndex.value = -1
    }
  }
)

onMounted(() => {
  /**
   * 挂载时也要主动读一次。
   *
   * 踩过的坑：SearchView 在 onMounted 里就 `inputEl.focus()`，所以下拉组件挂载时
   * `visible` 可能已经是 true —— watch 只在「变化」时触发，永远不响，历史一直是空的。
   * 读一次只是一次 IPC，代价可以忽略，换来的是不依赖父组件的时序。
   */
  void reload()
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('resize', reposition)
  window.addEventListener('scroll', reposition, true)
})

onBeforeUnmount(() => {
  detachAnchor()
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('resize', reposition)
  window.removeEventListener('scroll', reposition, true)
})

/* 暴露给父组件 / 验证探针：读历史、记一笔、看当前状态（defineExpose 只能调一次） */
const debugState = computed(() => ({
  visible: props.visible,
  open: open.value,
  count: items.value.length,
  activeIndex: activeIndex.value
}))
defineExpose({ reload, record, debugState })
</script>

<template>
  <!--
    测试钩子：一个永不参与布局的隐藏标记，把组件内部状态暴露给验证探针。
    为什么需要它：浮层在「不可见」时什么都不渲染，光看 DOM 分不清
    「父组件没让展开（visible=false）」和「展开了但没有可选项（count=0）」——
    这两种情况的排查方向完全相反。display:none 不影响布局，代价可以忽略。
  -->
  <span
    class="hist-state"
    hidden
    :data-visible="String(visible)"
    :data-open="String(open)"
    :data-count="items.length"
    :data-total="history.length"
    :data-loading="String(loading)"
    :data-err="loadError"
    :data-reloads="String(reloadCount)"
    :data-raw="rawSeen"
    :data-query="query"
    :data-active="String(activeIndex)"
  />

  <!--
    入场用**一次性 CSS 动画**（motion.css 的 .u-rise-in），不用 <Transition>。
    为什么：实测发现 <Transition name="pop"> 的离开过渡会「卡住」——
    组件状态已经是 open=false，.history-pop 却留在 DOM 里不走，
    变成一个盖在页面上的幽灵浮层（点外关闭与 Esc 都表现为「关不掉」）。
    下拉这种东西关闭本来就该是瞬时的：动画只在**出现**时放一次，
    这样元素的移除完全不依赖 transitionend，也就不会有残留。
  -->
  <!--
    浮层必须 Teleport 到 body —— 这是**位置正确性**的要求，不是洁癖。

    踩过的坑：下拉用 position:fixed + getBoundingClientRect 算坐标（视口坐标系），
    看起来天经地义；但 CSS 规定「带 transform 的祖先会成为 fixed 子元素的包含块」。
    而路由入场动画 `route-in` 的 keyframe 里带 translate3d，且 fill-mode 是 both
    （动画填满状态一直保留），于是内容容器**永久**成了包含块 ——
    fixed 的坐标被解释成「相对内容容器」，下拉整体右移 105px、下移 72px
    （正好等于容器的视口偏移），跑到输入框外面去了。

    挂到 body 之后，无论外层以后再加什么 transform / filter / will-change，
    这个浮层都不会再被劫持。
  -->
  <Teleport to="body">
    <div
      v-if="open"
      ref="rootEl"
      class="history-pop u-rise-in"
      :class="{ 'is-fixed': !!anchor }"
      :style="boxStyle"
    role="listbox"
    aria-label="搜索历史"
  >
      <div class="head">
        <span class="head-label">搜索历史</span>
        <button class="clear" type="button" title="清空搜索历史" @click="clearAll">清空全部</button>
      </div>

      <div
        v-for="(word, index) in items"
        :key="word"
        class="row"
        role="option"
        :aria-selected="index === activeIndex"
        :class="{ active: index === activeIndex }"
        :title="word"
        @mouseenter="activeIndex = index"
        @click="pick(index)"
      >
        <span class="word ellipsis">{{ word }}</span>
        <button
          class="del"
          type="button"
          :title="'删除「' + word + '」'"
          :aria-label="'删除历史记录 ' + word"
          @click="removeItem(word, $event)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/*
 * 浮层：零阴影体系下靠「描边 + 更高一档表面色」站起来。
 * 圆角归零（与全站一致），入场用基础层的 .pop（从锚点方向长出来）。
 */
.history-pop {
  position: absolute;
  z-index: 40;
  min-width: 220px;
  background: var(--surface-1);
  border: 1px solid var(--hairline-strong);
  padding: var(--sp-1) 0;
}

.history-pop.is-fixed {
  position: fixed;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: var(--sp-1) var(--sp-3);
  border-bottom: 1px solid var(--hairline-soft);
}

.head-label {
  font-family: var(--font-display);
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-wide);
  text-transform: uppercase;
  color: var(--ink-subtle);
}

.clear {
  /* 命中区 ≥24px：靠 padding 撑高，而不是改字号 */
  min-height: 24px;
  padding: 0 var(--sp-2);
  border: none;
  background: transparent;
  color: var(--ink-subtle);
  font-size: var(--fs-xs);
  cursor: pointer;
  transition: color var(--dur-1) var(--ease-out);
}

.clear:hover {
  color: var(--danger-text);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  /* 行高 32px：可点区域远超 24px 下限 */
  min-height: 32px;
  padding: 0 var(--sp-2) 0 var(--sp-3);
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out);
}

.row:hover,
.row.active {
  background: var(--surface-3);
}

.word {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  color: var(--ink);
}

.del {
  flex: none;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--ink-subtle);
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.del svg {
  width: 12px;
  height: 12px;
}

.del:hover {
  color: var(--danger-text);
  background: var(--surface-4);
}
</style>
