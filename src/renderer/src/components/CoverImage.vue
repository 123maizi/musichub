<script setup lang="ts">
/**
 * 封面图
 *
 * 为什么需要单独一个组件：
 * 封面来自各个平台的 CDN，失效、防盗链、返回占位图都是常态
 * （实测酷狗那套 URL 对任何专辑 id 都返回同一张 17853 字节的占位图）。
 * 直接在模板里写 <img> 会留下难看的裂图，这里统一退化成图标。
 *
 * 已全局注册（见 main.ts），模板里可直接用，无需 import。
 */
import { ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{
    src?: string
    alt?: string
    /** 占位图标的尺寸，跟随容器大小调整 */
    iconSize?: number
  }>(),
  {
    src: '',
    alt: '',
    iconSize: 22
  }
)

const failed = ref(false)

// 换歌时重置失败状态，否则新封面会被上一首的失败连累
watch(
  () => props.src,
  () => {
    failed.value = false
  }
)
</script>

<template>
  <img v-if="src && !failed" :src="src" :alt="alt" referrerpolicy="no-referrer" @error="failed = true" />
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
