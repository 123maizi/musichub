<script setup lang="ts">
/**
 * 封面图
 *
 * 为什么需要单独一个组件：
 * 封面来自各平台 CDN，失效、防盗链、返回占位图都是常态
 * （实测酷狗那套 URL 对任何专辑都返回同一张 17853 字节的占位图）。
 * 直接在模板里写 <img> 会留下难看的裂图，这里统一退化成图标。
 *
 * 另外还可以「跨平台补图」：平台没给封面时，按歌名+歌手去别处找一张。
 * 但这个能力默认关闭 —— 列表里几十首歌一起触发请求会打爆接口，
 * 只有播放条、正在播放页这类单张大图场景才值得打开。
 *
 * 已全局注册（见 main.ts），模板里可直接用，无需 import。
 */
import { computed, ref, watch } from 'vue'
import type { Song } from '@shared/types/music'
import AppIcon from './AppIcon.vue'
// 用带并发限流的版本：列表里几十首歌同时补图会把接口打爆
import { resolveCoverThrottled as resolveCover } from '../utils/cover'

const props = withDefaults(
  defineProps<{
    src?: string
    alt?: string
    /** 占位图标的尺寸，跟随容器大小调整 */
    iconSize?: number
    /** 缺图时是否跨平台补一张（仅建议用于单张大图场景） */
    fallback?: boolean
    /** 补图需要的歌曲信息 */
    song?: Song
  }>(),
  {
    src: '',
    alt: '',
    iconSize: 22,
    fallback: false,
    song: undefined
  }
)

const failed = ref(false)
const resolved = ref('')
const loading = ref(false)

/** 最终使用的地址：优先平台给的，其次补全来的 */
const finalSrc = computed(() => props.src || resolved.value)

/**
 * 尝试补一张封面。
 * 只在「开了补图、有歌曲信息、平台又没给地址」时才动手。
 */
async function tryFallback(): Promise<void> {
  if (!props.fallback || !props.song || props.src || loading.value) return
  if (resolved.value) return

  loading.value = true
  try {
    const url = await resolveCover(props.song)
    if (url) resolved.value = url
  } catch {
    /* 补图失败就保持占位图标，不影响其它功能 */
  } finally {
    loading.value = false
  }
}

/**
 * 换歌时重置状态并重新判断是否要补图。
 *
 * 这里刻意以 song.id 为触发源，而不是「是否需要补图」这个布尔值 ——
 * 后者在两首「都没有封面」的歌之间切换时始终为 true、从未变化，
 * watch 于是不触发：表现为上一首补上了、这一首却没补。
 * 播放条缩略图时有时无，就是这个原因。
 */
watch(
  () => props.song?.id,
  () => {
    failed.value = false
    resolved.value = ''
    void tryFallback()
  },
  { immediate: true }
)

/** 平台给了地址但图片加载失败时，也去补一张 */
watch(failed, (isFailed) => {
  if (isFailed) void tryFallback()
})
</script>

<template>
  <img
    v-if="finalSrc && !failed"
    :src="finalSrc"
    :alt="alt"
    referrerpolicy="no-referrer"
    @error="failed = true"
  />
  <AppIcon v-else name="music" :size="iconSize" />
</template>

<style scoped>
img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
