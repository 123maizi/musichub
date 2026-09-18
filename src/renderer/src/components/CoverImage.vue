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

/** 最终使用的地址：优先平台给的，其次补全来的 */
const finalSrc = computed(() => props.src || resolved.value)

/** 什么时候需要补图：开了开关、有歌曲信息、且当前没有可用地址 */
const needFallback = computed(
  () => props.fallback && Boolean(props.song) && (!props.src || failed.value)
)

// 换歌时重置，否则新封面会被上一首的失败状态连累
watch(
  () => [props.src, props.song?.id],
  () => {
    failed.value = false
    resolved.value = ''
  }
)

/**
 * 真的缺图时才去请求，且同一首歌只试一次。
 *
 * immediate 是关键：组件挂载时如果本来就缺封面（酷狗、酷我大量如此），
 * 不立即执行的话这个 watch 永远不会触发 —— 因为值从未「变化」过。
 * 少了这个选项，补图就只对「加载失败」生效，对「一开始就没图」完全没用，
 * 列表里那些歌于是永远没有封面。
 */
watch(
  needFallback,
  async (need) => {
    if (!need || resolved.value || !props.song) return
    try {
      const url = await resolveCover(props.song)
      if (url) resolved.value = url
    } catch {
      /* 补图失败就保持占位图标，不影响其它功能 */
    }
  },
  { immediate: true }
)
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
