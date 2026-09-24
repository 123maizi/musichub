<script setup lang="ts">
/**
 * 下载格式选择器。
 *
 * 以前只有设置页里一个叫「首选音质」的下拉框 —— 抽象的档位名，
 * 还要专门跑一趟设置页。现在直接把格式摆出来：MP3 / FLAC / 24bit，
 * 点一下就换，下载时立刻生效。
 */
import { computed } from 'vue'
import type { Quality } from '@shared/types/music'
import { DOWNLOAD_FORMATS, findFormat, normalizeFormatId } from '@shared/constants'

const props = withDefaults(
  defineProps<{
    modelValue?: Quality
    /** 紧凑模式：只留格式按钮，不显示说明行（搜索页工具条用） */
    compact?: boolean
    disabled?: boolean
  }>(),
  { compact: false, disabled: false }
)

const emit = defineEmits<{ (e: 'update:modelValue', value: Quality): void }>()

const current = computed(() => normalizeFormatId(props.modelValue))

const currentOption = computed(() => findFormat(props.modelValue))

function pick(id: Quality): void {
  if (props.disabled) return
  emit('update:modelValue', id)
}
</script>

<template>
  <div class="fmt" :class="{ compact }">
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
    <div v-if="!compact" class="note">
      <template v-if="currentOption">{{ currentOption.note }}</template>
      <template v-else>还没选过下载格式，点上面任意一项即可</template>
    </div>
  </div>
</template>

<style scoped>
.fmt {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.opts {
  display: flex;
  gap: 8px;
  flex-wrap: nowrap;
  overflow-x: auto;
  padding-bottom: 2px;
}

.opt {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  min-width: 74px;
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}

.opt b {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.opt span {
  font-size: 10px;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

.opt:hover:not(:disabled) {
  border-color: var(--text-dim);
  color: var(--text);
}

.opt.active {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

/* 无损档位在未选中时也稍微亮一点，方便一眼区分 */
.opt.lossless:not(.active) {
  border-color: color-mix(in srgb, var(--text-dim) 45%, transparent);
}

.opt:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.compact .opt {
  min-width: 62px;
  padding: 5px 10px;
}

.compact .opt b {
  font-size: 12px;
}

.compact .opt span {
  font-size: 9px;
}

.note {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.5;
}
</style>
