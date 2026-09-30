<script setup lang="ts">
/**
 * 下载格式选择器。
 *
 * 以前只有设置页里一个叫「首选音质」的下拉框 —— 抽象的档位名，
 * 还要专门跑一趟设置页。现在直接把格式摆出来：MP3 / FLAC / 24bit，
 * 点一下就换，下载时立刻生效。
 *
 * 两种呈现（都保留全部 4 个格式，不砍功能）：
 *   · 默认（设置页 / 下载页）：一行平铺 4 个按钮 + 说明行 —— 这两处本来就是
 *     「配置格式」的场景，一眼看全最合适。
 *   · compact（搜索页工具条）：**收成一个下拉**。搜索页那一行要同时放搜索框、
 *     品类切换、平台 tab，平铺 4 个格式按钮会把顶栏挤成工具栏；收起来只占 1 个控件位。
 *     判定标准是 lead 定的：「这一次要做什么」在台面上，「长期偏好」收起来。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Quality } from '@shared/types/music'
import { DOWNLOAD_FORMATS, findFormat, normalizeFormatId } from '@shared/constants'

const props = withDefaults(
  defineProps<{
    modelValue?: Quality
    /** 紧凑模式：收成一个下拉（搜索页工具条用） */
    compact?: boolean
    disabled?: boolean
  }>(),
  { compact: false, disabled: false }
)

const emit = defineEmits<{ (e: 'update:modelValue', value: Quality): void }>()

const current = computed(() => normalizeFormatId(props.modelValue))

const currentOption = computed(() => findFormat(props.modelValue))

/** 下拉展开状态（仅 compact 用） */
const open = ref(false)
const root = ref<HTMLElement | null>(null)

function toggle(): void {
  if (props.disabled) return
  open.value = !open.value
}

function pick(id: Quality): void {
  if (props.disabled) return
  emit('update:modelValue', id)
  open.value = false
}

/** 点空白处收起：监听挂 document，卸载时移除，避免列表里几十个实例泄漏 */
function onDocPointerDown(e: PointerEvent): void {
  if (!open.value) return
  const el = root.value
  if (el && !el.contains(e.target as Node)) open.value = false
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && open.value) open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onKeydown)
})

/** 触发器上的文字：优先「格式 + 码率」，没选过就说人话 */
const triggerText = computed(() => {
  const f = currentOption.value
  if (!f) return '选择格式'
  return `${f.format} ${f.rate}`
})
</script>

<template>
  <!-- 紧凑：一个触发器 + 下拉，占 1 个控件位 -->
  <div v-if="compact" ref="root" class="fmt-menu">
    <button
      type="button"
      class="trigger"
      :class="{ open }"
      :disabled="disabled"
      :title="currentOption?.note ?? '选择下载格式'"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="trigger-text">{{ triggerText }}</span>
      <svg class="caret" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <Transition name="pop">
      <div v-if="open" class="menu" role="menu" aria-label="下载格式">
        <button
          v-for="f in DOWNLOAD_FORMATS"
          :key="f.id"
          type="button"
          class="menu-item"
          :class="{ active: current === f.id }"
          role="menuitemradio"
          :aria-checked="current === f.id"
          @click="pick(f.id)"
        >
          <span class="menu-item-head">
            <b>{{ f.format }}</b>
            <span class="rate">{{ f.rate }}</span>
          </span>
          <span class="menu-item-note">{{ f.note }}</span>
        </button>
      </div>
    </Transition>
  </div>

  <!-- 默认：平铺，一眼看全 -->
  <div v-else class="fmt">
    <div class="opts" role="group" aria-label="下载格式">
      <button
        v-for="f in DOWNLOAD_FORMATS"
        :key="f.id"
        type="button"
        class="opt"
        :class="{ active: current === f.id, lossless: f.lossless }"
        :disabled="disabled"
        :title="f.note"
        @click="pick(f.id)"
      >
        <b>{{ f.format }}</b>
        <span>{{ f.rate }}</span>
      </button>
    </div>
    <div class="note">
      <template v-if="currentOption">{{ currentOption.note }}</template>
      <template v-else>还没选过下载格式，点上面任意一项即可</template>
    </div>
  </div>
</template>

<style scoped>
/**
 * 全部取值走 token：间距 4px 网格、圆角只有 --r-ctl、时长只有 --dur-1/--dur-2。
 * 这块以前是「离网间距 + 8px 圆角 + 0.12s」的漂移来源之一。
 */
.fmt {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
}

.opts {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: nowrap;
  overflow-x: auto;
  padding-bottom: var(--sp-1);
}

.opt {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 74px;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-ctl);
  border: 1px solid var(--hairline);
  background: var(--surface-2);
  color: var(--ink-muted);
  cursor: pointer;
  /* 只动颜色：绘制属性，不触发布局 */
  transition:
    border-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.opt b {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-wide);
}

.opt span {
  font-size: var(--fs-xs);
  opacity: 0.75;
}

.opt:hover:not(:disabled) {
  border-color: var(--hairline-strong);
  color: var(--ink);
}

.opt.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

/* 无损档位在未选中时也用刻线色区分一下，方便一眼看出 */
.opt.lossless:not(.active) {
  border-color: var(--hairline-strong);
}

.opt:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.note {
  font-size: var(--fs-xs);
  color: var(--ink-muted);
  line-height: var(--lh-base);
}

/* ------------------------------ 紧凑下拉 ------------------------------ */

.fmt-menu {
  position: relative;
  display: inline-flex;
}

.trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-ctl);
  border: 1px solid var(--hairline);
  background: var(--surface-2);
  color: var(--ink);
  cursor: pointer;
  transition:
    border-color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.trigger:hover:not(:disabled) {
  border-color: var(--hairline-strong);
  background: var(--surface-3);
}

.trigger.open {
  border-color: var(--accent);
}

.trigger-text {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  font-variant-numeric: tabular-nums;
}

.caret {
  width: 12px;
  height: 12px;
  flex: none;
  color: var(--ink-subtle);
  transition: transform var(--dur-2) var(--ease-out);
}

.trigger.open .caret {
  transform: rotate(180deg);
}

/* 面板：位置绝对、靠 .pop 过渡类做 scale 0.98 + 淡入（契约里的弹层动效） */
.menu {
  position: absolute;
  top: calc(100% + var(--sp-1));
  right: 0;
  z-index: 20;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  padding: var(--sp-1);
  border: 1px solid var(--hairline-strong);
  border-radius: var(--r-card);
  /**
   * 全站禁用阴影 —— 弹层也不例外。
   * 浮起来靠的是「白板 + 1px 刻线 + 与暖白画布的明度差」，不是投影：
   * 大理石/石膏的语言里没有投影，加了反而显脏、也把古典感拉回现代 SaaS。
   */
  background: var(--surface-1);
}

.menu-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
  padding: var(--sp-2) var(--sp-3);
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--ink-muted);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.menu-item:hover {
  background: var(--surface-3);
  color: var(--ink);
}

.menu-item.active {
  /* 当前项：左侧 2px 青铜刻线 + 淡底，和导航柱同一套「分柱」语言 */
  box-shadow: inset 2px 0 0 var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.menu-item-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
}

.menu-item-head b {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-wide);
}

.menu-item-head .rate {
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}

.menu-item-note {
  font-size: var(--fs-xs);
  color: var(--ink-subtle);
  line-height: var(--lh-base);
}
</style>
