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
  try {
    loading.value = true
    const prefs = await window.api.prefs.get()
    history.value = Array.isArray(prefs?.searchHistory) ? prefs.searchHistory : []
  } catch {
    // 读不到历史就当作没有：绝不能因为它把搜索框弄坏
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
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('resize', reposition)
  window.addEventListener('scroll', reposition, true)
})

onBeforeUnmount(() => {
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
  <Transition name="pop">
    <div
      v-if="open"
      ref="rootEl"
      class="history-pop"
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
  </Transition>
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
