<script setup lang="ts">
/**
 * 封面图
 *
 * 为什么需要单独一个组件：
 * 封面来自各平台 CDN，失效、防盗链、返回占位图都是常态
 * （实测酷狗那套 URL 对任何专辑都返回同一张 17853 字节的占位图）。
 * 直接在模板里写 <img> 会留下难看的裂图，这里统一退化成图标。
 *
 * 「加载不出来」有四种成因，这个组件按顺序逐个兜：
 *   1. 地址本身就挂了 / CDN 抖动 —— 换下一个候选重试
 *   2. 防盗链（403）—— 改成走主进程的本地流代理，由它在服务端补 Referer/UA
 *   3. 平台压根没给封面 —— 跨平台补一张（仅 fallback 打开时）
 *   4. 补来的也挂了 —— 退回平台那张；全都不行才显示占位图标
 *
 * 关键教训：**绝不挂错封面**。补图时的歌名/歌手比对在主进程完成
 * （见 core/cover 的 pickCover），拿不准就返回 null，这里宁可显示占位图标。
 *
 * 已全局注册（见 main.ts），模板里可直接用，无需 import。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Song } from '@shared/types/music'
import AppIcon from './AppIcon.vue'
// 用带并发限流的版本：列表里几十首歌同时补图会把接口打爆
import {
  ensureCoverProxyPort,
  proxiedCoverUrl,
  resolveCoverThrottled as resolveCover
} from '../utils/cover'

const props = withDefaults(
  defineProps<{
    src?: string
    alt?: string
    /** 占位图标的尺寸，跟随容器大小调整 */
    iconSize?: number
    /** 缺图时是否跨平台补一张（仅建议用于单张大图场景） */
    fallback?: boolean
    /**
     * 是否优先用跨平台补来的封面（大图场景）。
     *
     * 为什么需要：平台自己的封面未必能用 —— 酷我有些专辑压根没给真封面，
     * 而是塞一张「红底＋中间一张小图」的占位图，从 120px 要到 1000px
     * 都是同一张；这类封面上大图会非常难看。
     * 补不到就继续用平台那张，所以最坏情况与不放这个开关时一致。
     */
    preferResolved?: boolean
    /** 补图需要的歌曲信息 */
    song?: Song
  }>(),
  {
    src: '',
    alt: '',
    iconSize: 22,
    fallback: false,
    preferResolved: false,
    song: undefined
  }
)

/** 已经试过的地址（含代理形态）；每个地址只试一次 */
const attempted = ref<string[]>([])
/** 当前挂在 <img> 上的地址；为空表示显示占位图标 */
const activeSrc = ref('')
/** 跨平台补来的地址 */
const resolved = ref('')
/** 是否正在补图（防止并发重复补） */
const resolving = ref(false)
/** 已经补过几轮；限次，避免「补来的挂了 → 再补 → 又挂」打成死循环 */
const resolveRounds = ref(0)
const MAX_RESOLVE_ROUNDS = 2

/**
 * 第一轮补图失败后的自愈重试间隔。
 *
 * 为什么不能「失败就算了」：补图依赖的两个搜索接口结果并不稳定 ——
 * 实测同一个关键词连着调两次，酷狗会把「烟花易冷 - 周杰伦」从第 1 位挪到第 4 位；
 * 同一个候选这次带 union_cover、下次不带。也就是说一次失败不等于这首歌没有封面。
 *
 * 只重试一次，避免变成对别人接口的轮询。
 * 30 秒要大于主进程的负缓存 TTL（20 秒），否则重试会被负缓存直接挡回去。
 */
const RETRY_DELAY_MS = 30_000
let retryTimer: ReturnType<typeof setTimeout> | null = null

function clearRetry(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

/**
 * 换歌 / 换地址时作废旧的异步结果。
 *
 * 为什么需要：补图是跨进程请求，耗时可能几百毫秒；这期间用户完全可能
 * 已经切到下一首。旧请求回来后如果直接写状态，就会把上一首的封面
 * 盖到这一首上 —— 那正是「张冠李戴」。
 */
let generation = 0
let disposed = false

onBeforeUnmount(() => {
  disposed = true
  generation += 1
  clearRetry()
})

/**
 * 列表缩略图才懒加载。
 *
 * 判据用 iconSize 而不是新增 prop：SongTable / DownloadView / 艺人卡片
 * 这些都是 ≤32 的小图（一屏几十上百张，最该让位给首屏），
 * 而正在播放页（56）那种大图必须立刻出来。
 */
const lazyLoad = computed(() => props.iconSize <= 32)

/**
 * 依次尝试的地址列表。
 *
 * 直连在前、本地代理在后：代理只作为防盗链/抖动的兜底，
 * 能直连就直连（少一次本机往返，也少占一个代理连接）。
 * `preferResolved` 时把补来的图排在平台图前面（大图场景的既有语义）。
 */
const candidates = computed<string[]>(() => {
  const platform = (props.src ?? '').trim()
  const cross = resolved.value
  const order = props.preferResolved && cross ? [cross, platform] : [platform, cross]

  const direct = order.filter((url): url is string => !!url)
  const out: string[] = [...direct]
  for (const url of direct) {
    const proxied = proxiedCoverUrl(props.song?.platform, url)
    if (proxied && !out.includes(proxied)) out.push(proxied)
  }
  return out
})

/** 挑下一个还没试过的地址；都试完了就去补图，补不到就显示占位图标 */
function pickNext(): void {
  if (disposed) return
  // 当前这个还在加载中（没失败过），别打断它
  if (activeSrc.value && !attempted.value.includes(activeSrc.value)) return

  const next = candidates.value.find((url) => !attempted.value.includes(url))
  if (next) {
    activeSrc.value = next
    return
  }

  // 所有候选都试过了：先看能不能跨平台补一张
  activeSrc.value = ''
  void tryResolve()
}

/** 当前地址加载失败：记下来，换下一个 */
function onImgError(): void {
  if (activeSrc.value && !attempted.value.includes(activeSrc.value)) {
    attempted.value = [...attempted.value, activeSrc.value]
  }
  pickNext()
}

/**
 * 跨平台补一张。
 *
 * 「有 src 却加载不出来」过去是补不了的 —— 老实现里
 * `if (!preferResolved && props.src) return` 把这条路直接堵死，
 * 于是挂着死链的行永远只剩占位图标。现在改成「直连和代理都失败之后才补」，
 * 既保住了「有可用封面就不乱发请求」，又真的能兜住死链。
 *
 * 补不到时安排一次延迟自愈（只一次）：上游抖动导致的失败不该变成
 * 「这首歌这辈子都没封面」。
 */
async function tryResolve(): Promise<void> {
  if (disposed || resolving.value) return
  if (!props.fallback || !props.song) return
  if (resolveRounds.value >= MAX_RESOLVE_ROUNDS) return

  const gen = generation
  resolveRounds.value += 1
  const force = resolveRounds.value > 1
  resolving.value = true
  try {
    const url = await resolveCover(props.song, force)
    // 切歌了 / 组件已卸载：丢弃这次结果，绝不写到新歌上
    if (disposed || gen !== generation) return
    if (url) {
      if (url !== resolved.value) resolved.value = url
      pickNext()
      return
    }
    scheduleRetry()
  } catch {
    /* 补图失败就保持占位图标，不影响其它功能 */
    if (gen === generation) scheduleRetry()
  } finally {
    if (gen === generation) resolving.value = false
  }
}

/** 安排一次延迟重试；同一时刻只留一个定时器，切歌/卸载时清掉 */
function scheduleRetry(): void {
  if (disposed || retryTimer !== null) return
  if (resolveRounds.value >= MAX_RESOLVE_ROUNDS) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void tryResolve()
  }, RETRY_DELAY_MS)
}

/** 换歌 / 换地址：清空所有尝试记录，从头来一遍 */
function reset(): void {
  generation += 1
  clearRetry()
  attempted.value = []
  activeSrc.value = ''
  resolved.value = ''
  resolveRounds.value = 0
  resolving.value = false

  pickNext()
  // 大图场景要优先显示补来的封面，这里主动补一次；
  // 列表场景只在「直连真的挂了」之后才补，不然几十行会白打一堆接口。
  if (props.preferResolved && props.fallback && props.song) void tryResolve()
}

/**
 * 以 song.id 为触发源，而不是「是否需要补图」这个布尔值 ——
 * 后者在两首「都没有封面」的歌之间切换时始终为 true、从未变化，
 * watch 于是不触发：表现为上一首补上了、这一首却没补。
 * 播放条缩略图时有时无，就是这个原因。
 */
watch(() => props.song?.id, reset, { immediate: true })

/** 同一首歌的平台封面地址也可能变（切平台/切音源），变了就重新走一遍 */
watch(
  () => props.src,
  (next, prev) => {
    if ((next ?? '') !== (prev ?? '')) reset()
  }
)

/** 代理端口是异步拿到的；拿到后如果正卡在占位图标上，就再用代理试一次 */
void ensureCoverProxyPort().then(() => {
  if (!disposed && !activeSrc.value) pickNext()
})
</script>

<template>
  <img
    v-if="activeSrc"
    :src="activeSrc"
    :alt="alt"
    :loading="lazyLoad ? 'lazy' : 'eager'"
    decoding="async"
    referrerpolicy="no-referrer"
    @error="onImgError"
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
