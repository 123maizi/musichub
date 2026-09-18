<script setup lang="ts">
/**
 * 正在播放页
 *
 * 大封面 + 滚动歌词。所有图标用内联 SVG（见 AppIcon），
 * 刻意不用 ⏮ ▶ ⏭ 这类符号 —— 它们在 Windows 上会被渲染成彩色 emoji 方块。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { PLATFORM_META, QUALITY_META } from '@shared/constants'
import AppIcon from '../components/AppIcon.vue'
import { useDownloadStore } from '../stores/downloads'
import { useLibraryStore } from '../stores/library'
import { usePlayerStore } from '../stores/player'
import { formatTime } from '../utils/format'

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const downloads = useDownloadStore()

const lyricBox = ref<HTMLElement | null>(null)
const toast = ref<string | null>(null)
const seeking = ref(false)
const seekValue = ref(0)

/** 播放模式 → 图标名 */
const MODE_ICON = {
  order: 'list',
  loop: 'loop',
  single: 'single',
  shuffle: 'shuffle'
} as const

const platformName = computed(() =>
  player.current ? (PLATFORM_META[player.current.platform]?.name ?? player.current.platform) : ''
)

const qualityLabel = computed(() => {
  const q = player.urlInfo?.quality ?? player.quality
  return QUALITY_META[q]?.short ?? String(q)
})

const isFavorite = computed(() =>
  player.current ? library.isFavorite(player.current.id) : false
)

const hasLyric = computed(() => player.lyricLines.length > 0)

const lyricHint = computed(() => {
  if (hasLyric.value) return ''
  if (player.loading) return '正在获取歌词…'
  if (!player.current) return '还没有开始播放'
  return '这首歌暂时没有歌词'
})

/* ------------------------------ 进度条 ------------------------------ */

const displayProgress = computed(() =>
  seeking.value ? seekValue.value : player.progress
)

const displayTime = computed(() =>
  seeking.value && player.duration > 0
    ? (seekValue.value / 100) * player.duration
    : player.currentTime
)

function onSeekInput(event: Event): void {
  seeking.value = true
  seekValue.value = Number((event.target as HTMLInputElement).value)
}

function onSeekCommit(event: Event): void {
  player.seekByPercent(Number((event.target as HTMLInputElement).value))
  seeking.value = false
}

/* ------------------------------ 歌词滚动 ------------------------------ */

watch(
  () => player.currentLyricIndex,
  async (index) => {
    const box = lyricBox.value
    if (index < 0 || !box) return
    await nextTick()
    const line = box.querySelector<HTMLElement>(`[data-line="${index}"]`)
    if (!line) return
    // 用容器自身滚动，避免把整个页面顶跑
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: 'smooth'
    })
  }
)

/* ------------------------------ 操作 ------------------------------ */

function notify(message: string): void {
  toast.value = message
  setTimeout(() => {
    if (toast.value === message) toast.value = null
  }, 2200)
}

async function toggleFavorite(): Promise<void> {
  const song = player.current
  if (!song) return
  await library.toggleFavorite(song)
  notify(isFavorite.value ? '已收藏' : '已取消收藏')
}

async function downloadCurrent(): Promise<void> {
  const song = player.current
  if (!song) return
  await downloads.add([song], { quality: player.quality })
  notify('已加入下载队列')
}

function queueCurrent(): void {
  const song = player.current
  if (song) {
    player.addToQueue(song)
    notify('已加入播放队列')
  }
}
</script>

<template>
  <section class="view">
    <header class="bar">
      <button class="icon-btn" title="返回" @click="router.back()">
        <AppIcon name="back" :size="18" />
      </button>
      <div class="grow"></div>
      <span v-if="player.urlInfo" class="tag accent" :title="`由音源「${player.urlInfo.sourceName}」提供`">
        {{ qualityLabel }}
      </span>
      <span v-if="player.urlInfo" class="faint src-name ellipsis">{{ player.urlInfo.sourceName }}</span>
    </header>

    <div class="stage">
      <!-- 左：封面与控制 -->
      <div class="left">
        <div class="cover">
          <CoverImage
            :src="player.current?.picUrl"
            :song="player.current ?? undefined"
            :icon-size="56"
            fallback
          />
        </div>

        <div class="meta">
          <h1 class="ellipsis" :title="player.current?.name">
            {{ player.current?.name ?? '未在播放' }}
          </h1>
          <div class="sub ellipsis">
            <span>{{ player.current?.singer ?? '—' }}</span>
            <span v-if="player.current" class="faint"> · {{ platformName }}</span>
          </div>
          <div v-if="player.current?.albumName" class="album faint ellipsis">
            {{ player.current.albumName }}
          </div>
        </div>

        <div class="tools">
          <button class="tool" :class="{ on: isFavorite }" :disabled="!player.current" @click="toggleFavorite">
            <AppIcon :name="isFavorite ? 'heart-filled' : 'heart'" :size="15" :filled="isFavorite" />
            <span>{{ isFavorite ? '已收藏' : '收藏' }}</span>
          </button>
          <button class="tool" :disabled="!player.current" @click="downloadCurrent">
            <AppIcon name="download" :size="15" />
            <span>下载</span>
          </button>
          <button class="tool" :disabled="!player.current" @click="queueCurrent">
            <AppIcon name="plus" :size="15" />
            <span>队列</span>
          </button>
        </div>

        <!-- 进度 -->
        <div class="progress-row">
          <span class="time mono">{{ formatTime(displayTime) }}</span>
          <input
            class="seek"
            type="range"
            min="0"
            max="100"
            step="0.1"
            :value="displayProgress"
            :disabled="!player.current || player.duration <= 0"
            @input="onSeekInput"
            @change="onSeekCommit"
          />
          <span class="time mono faint">{{ formatTime(player.duration) }}</span>
        </div>

        <!-- 传输控制 -->
        <div class="controls">
          <button class="ctrl" title="上一首" :disabled="player.playlist.length === 0" @click="player.playPrev()">
            <AppIcon name="prev" :size="22" />
          </button>
          <button
            class="ctrl main"
            :title="player.playing ? '暂停' : '播放'"
            :disabled="!player.current || player.loading"
            @click="player.toggle()"
          >
            <AppIcon :name="player.playing ? 'pause' : 'play'" :size="24" />
          </button>
          <button class="ctrl" title="下一首" :disabled="player.playlist.length === 0" @click="player.playNext()">
            <AppIcon name="next" :size="22" />
          </button>
          <button class="mode-btn" :title="player.modeLabel" @click="player.cycleMode()">
            <AppIcon :name="MODE_ICON[player.mode]" :size="15" />
            <span>{{ player.modeLabel }}</span>
          </button>
        </div>
      </div>

      <!-- 右：歌词 -->
      <div class="right">
        <div v-if="!hasLyric" class="lyric-empty">
          <AppIcon name="music" :size="26" />
          <span>{{ lyricHint }}</span>
        </div>

        <div v-else ref="lyricBox" class="lyric-box">
          <div class="lyric-pad"></div>
          <div
            v-for="(line, index) in player.lyricLines"
            :key="index"
            class="lyric-line"
            :class="{ active: index === player.currentLyricIndex }"
            :data-line="index"
            @click="player.seek(line.time)"
          >
            {{ line.text || '·' }}
          </div>
          <div class="lyric-pad"></div>
        </div>
      </div>
    </div>

    <div v-if="player.error" class="error-strip">
      <span class="ellipsis">{{ player.error }}</span>
      <button class="ghost small" @click="player.error = null">知道了</button>
    </div>

    <Transition name="fade">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
  </section>
</template>

<style scoped>
.view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
}

/* ------------------------------ 顶栏 ------------------------------ */

.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--line-soft);
}

.icon-btn {
  width: 32px;
  height: 32px;
  padding: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: transparent;
  border: 1px solid var(--line);
  color: var(--text-dim);
}

.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.src-name {
  max-width: 150px;
  font-size: 11.5px;
}

.small {
  font-size: 12px;
}

/* ------------------------------ 布局 ------------------------------ */

.stage {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(300px, 400px) 1fr;
  gap: 40px;
  padding: 30px 36px;
  overflow: hidden;
}

.left {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
  overflow-y: auto;
}

/* ------------------------------ 封面 ------------------------------ */

.cover {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 14px;
  overflow: hidden;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  color: var(--text-faint);
  flex: none;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* ------------------------------ 曲目信息 ------------------------------ */

.meta {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.meta h1 {
  font-size: 21px;
  font-weight: 600;
  line-height: 1.35;
}

.sub {
  font-size: 13px;
  color: var(--text-dim);
}

.album {
  font-size: 12px;
}

/* ------------------------------ 工具胶囊 ------------------------------ */

.tools {
  display: flex;
  gap: 8px;
}

.tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  font-size: 12.5px;
  border-radius: 18px;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  color: var(--text-dim);
}

.tool:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.tool.on {
  color: var(--accent);
  border-color: rgba(212, 162, 76, 0.35);
  background: var(--accent-soft);
}

/* ------------------------------ 进度 ------------------------------ */

.progress-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.time {
  font-size: 11.5px;
  color: var(--text-dim);
  min-width: 42px;
  text-align: center;
}

.seek {
  flex: 1;
  min-width: 0;
  height: 20px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}

.seek::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: var(--line);
}

.seek::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 13px;
  height: 13px;
  margin-top: -4.5px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px rgba(212, 162, 76, 0.15);
}

.seek:disabled {
  opacity: 0.4;
  cursor: default;
}

/* ------------------------------ 控制按钮 ------------------------------ */

.controls {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 2px;
}

.ctrl {
  width: 46px;
  height: 46px;
  padding: 0;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: var(--text-dim);
  display: grid;
  place-items: center;
  transition: background 0.14s, color 0.14s, transform 0.1s;
}

.ctrl:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.ctrl:active:not(:disabled) {
  transform: scale(0.94);
}

.ctrl.main {
  width: 60px;
  height: 60px;
  background: var(--accent);
  color: #1a1408;
  box-shadow: 0 6px 20px rgba(212, 162, 76, 0.28);
}

.ctrl.main:hover:not(:disabled) {
  background: #e0b05c;
  color: #1a1408;
}

.ctrl:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 16px;
  background: transparent;
  border: 1px solid var(--line);
  color: var(--text-dim);
}

.mode-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

/* ------------------------------ 歌词 ------------------------------ */

.right {
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.lyric-box {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  mask-image: linear-gradient(180deg, transparent, #000 14%, #000 86%, transparent);
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 14%, #000 86%, transparent);
}

.lyric-box::-webkit-scrollbar {
  display: none;
}

.lyric-pad {
  height: 42%;
}

.lyric-line {
  padding: 10px 10px;
  font-size: 15.5px;
  line-height: 1.6;
  color: var(--text-faint);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color 0.18s, background 0.18s;
}

.lyric-line:hover {
  background: var(--bg-hover);
  color: var(--text-dim);
}

.lyric-line.active {
  color: var(--accent);
  font-size: 17px;
  font-weight: 600;
}

.lyric-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  height: 100%;
  color: var(--text-faint);
  font-size: 13px;
}

/* ------------------------------ 其它 ------------------------------ */

.error-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 20px;
  background: rgba(212, 87, 76, 0.1);
  border-top: 1px solid rgba(212, 87, 76, 0.35);
  font-size: 12px;
  color: #e79a92;
}

.toast {
  position: absolute;
  bottom: 22px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 18px;
  border-radius: 20px;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  font-size: 12.5px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
