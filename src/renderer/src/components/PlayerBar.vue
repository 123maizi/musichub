<script setup lang="ts">
/**
 * 底部播放条
 * 图标全部走 AppIcon（内联 SVG），不再使用 ⏮ ▶ ⏭ 这类符号。
 */
import { computed, ref } from 'vue'
import { PLATFORM_META, QUALITY_META } from '@shared/constants'
import AppIcon from './AppIcon.vue'
import { useDownloadStore } from '../stores/downloads'
import { useLibraryStore } from '../stores/library'
import { usePlayerStore } from '../stores/player'
import { formatTime } from '../utils/format'

const player = usePlayerStore()
const downloads = useDownloadStore()
const library = useLibraryStore()

/** 播放模式 → 图标名 */
const MODE_ICON = {
  order: 'list',
  loop: 'loop',
  single: 'single',
  shuffle: 'shuffle'
} as const

const seeking = ref(false)
const seekValue = ref(0)

const platformName = computed(() =>
  player.current ? (PLATFORM_META[player.current.platform]?.name ?? player.current.platform) : ''
)

const qualityLabel = computed(() => {
  const q = player.urlInfo?.quality ?? player.quality
  return QUALITY_META[q]?.short ?? String(q)
})

const isCurrentFavorite = computed(() =>
  player.current ? library.isFavorite(player.current.id) : false
)

/** 拖动进度条时先用本地值预览，松手才真正 seek */
const displayProgress = computed(() => (seeking.value ? seekValue.value : player.progress))

function onSeekInput(event: Event): void {
  seeking.value = true
  seekValue.value = Number((event.target as HTMLInputElement).value)
}

function onSeekCommit(event: Event): void {
  player.seekByPercent(Number((event.target as HTMLInputElement).value))
  seeking.value = false
}

function onVolume(event: Event): void {
  player.setVolume(Number((event.target as HTMLInputElement).value) / 100)
}

async function toggleFavorite(): Promise<void> {
  const song = player.current
  if (!song) return
  await library.toggleFavorite(song)
}

async function downloadCurrent(): Promise<void> {
  const song = player.current
  if (!song) return
  await downloads.add([song], { quality: player.quality })
}
</script>

<template>
  <footer class="player-bar">
    <!-- 进度条贴在最上沿，视觉上不占高度 -->
    <div class="progress-track">
      <input
        class="progress-input"
        type="range"
        min="0"
        max="100"
        step="0.1"
        :value="displayProgress"
        :disabled="!player.current || player.duration <= 0"
        @input="onSeekInput"
        @change="onSeekCommit"
      />
    </div>

    <div class="bar-body">
      <!-- 左：当前曲目（点击进入正在播放页） -->
      <router-link
        class="now"
        to="/now-playing"
        title="查看大图与歌词"
        style="text-decoration: none; color: inherit"
      >
        <div class="cover">
          <CoverImage :src="player.current?.picUrl" :icon-size="20" />
        </div>

        <div class="now-text">
          <template v-if="player.current">
            <div class="now-title ellipsis">{{ player.current.name }}</div>
            <div class="now-sub ellipsis">
              {{ player.current.singer }}
              <span class="faint">· {{ platformName }}</span>
            </div>
          </template>
          <template v-else>
            <div class="now-title faint">未在播放</div>
            <div class="now-sub faint">在搜索页点一首歌开始</div>
          </template>
        </div>
      </router-link>

      <!-- 中：传输控制 -->
      <div class="controls">
        <div class="buttons">
          <button
            class="ctrl"
            title="上一首"
            :disabled="player.playlist.length === 0"
            @click="player.playPrev()"
          >
            <AppIcon name="prev" :size="18" />
          </button>

          <button
            class="ctrl main"
            :title="player.playing ? '暂停' : '播放'"
            :disabled="!player.current || player.loading"
            @click="player.toggle()"
          >
            <AppIcon :name="player.playing ? 'pause' : 'play'" :size="18" />
          </button>

          <button
            class="ctrl"
            title="下一首"
            :disabled="player.playlist.length === 0"
            @click="player.playNext()"
          >
            <AppIcon name="next" :size="18" />
          </button>
        </div>

        <div class="time-row mono">
          <span>{{ formatTime(player.currentTime) }}</span>
          <span class="faint">/ {{ formatTime(player.duration) }}</span>
        </div>
      </div>

      <!-- 右：音质 / 模式 / 收藏 / 下载 / 音量 -->
      <div class="tools">
        <span v-if="player.urlInfo" class="tag accent" :title="`由音源「${player.urlInfo.sourceName}」提供`">
          {{ qualityLabel }}
        </span>
        <span v-if="player.urlInfo" class="src-name ellipsis" :title="player.urlInfo.sourceName">
          {{ player.urlInfo.sourceName }}
        </span>

        <button class="icon-btn" :title="player.modeLabel" @click="player.cycleMode()">
          <AppIcon :name="MODE_ICON[player.mode]" :size="16" />
        </button>

        <button
          class="icon-btn"
          :class="{ on: isCurrentFavorite }"
          :disabled="!player.current"
          :title="isCurrentFavorite ? '取消收藏' : '收藏到我的喜欢'"
          @click="toggleFavorite"
        >
          <AppIcon :name="isCurrentFavorite ? 'heart-filled' : 'heart'" :size="16" :filled="isCurrentFavorite" />
        </button>

        <button class="icon-btn" :disabled="!player.current" title="下载当前歌曲" @click="downloadCurrent">
          <AppIcon name="download" :size="16" />
        </button>

        <input
          class="volume"
          type="range"
          min="0"
          max="100"
          :value="Math.round(player.volume * 100)"
          title="音量"
          @input="onVolume"
        />
      </div>
    </div>

    <!-- 错误提示：音源失效时给出明确反馈 -->
    <div v-if="player.error" class="error-strip">
      <span class="ellipsis">{{ player.error }}</span>
      <button class="ghost small" @click="player.error = null">知道了</button>
    </div>
  </footer>
</template>

<style scoped>
.player-bar {
  position: relative;
  height: 78px;
  border-top: 1px solid var(--line);
  background: var(--bg-panel);
}

/* ------------------------------ 进度 ------------------------------ */

.progress-track {
  position: absolute;
  top: -6px;
  left: 0;
  right: 0;
  height: 12px;
  display: flex;
  align-items: center;
}

.progress-input {
  width: 100%;
  height: 12px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}

.progress-input::-webkit-slider-runnable-track {
  height: 3px;
  background: var(--line);
}

.progress-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 11px;
  height: 11px;
  margin-top: -4px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0;
  transition: opacity 0.15s;
}

.progress-input:hover::-webkit-slider-thumb,
.progress-input:focus::-webkit-slider-thumb {
  opacity: 1;
}

.progress-input:disabled {
  cursor: default;
}

/* ------------------------------ 主体 ------------------------------ */

.bar-body {
  display: grid;
  grid-template-columns: minmax(200px, 1fr) auto minmax(200px, 1fr);
  align-items: center;
  gap: 16px;
  height: 100%;
  padding: 0 18px;
}

.now {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  cursor: pointer;
}

.cover {
  flex: none;
  width: 46px;
  height: 46px;
  border-radius: 9px;
  overflow: hidden;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  color: var(--text-faint);
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.now-text {
  min-width: 0;
  line-height: 1.35;
}

.now-title {
  font-size: 13.5px;
  font-weight: 600;
}

.now-sub {
  font-size: 12px;
  color: var(--text-dim);
}

/* ------------------------------ 控制 ------------------------------ */

.controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ctrl {
  width: 32px;
  height: 32px;
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
  transform: scale(0.93);
}

.ctrl.main {
  width: 40px;
  height: 40px;
  background: var(--accent);
  color: #1a1408;
}

.ctrl.main:hover:not(:disabled) {
  background: #e0b05c;
  color: #1a1408;
}

.ctrl:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.time-row {
  font-size: 11px;
  color: var(--text-dim);
  letter-spacing: 0.02em;
}

/* ------------------------------ 工具区 ------------------------------ */

.tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
}

.icon-btn {
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: var(--text-dim);
  display: grid;
  place-items: center;
}

.icon-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.icon-btn.on {
  color: var(--accent);
}

.icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.src-name {
  max-width: 110px;
  font-size: 11px;
  color: var(--text-faint);
}

.volume {
  width: 76px;
  height: 14px;
  padding: 0;
  border: none;
  background: transparent;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}

.volume::-webkit-slider-runnable-track {
  height: 3px;
  background: var(--line);
  border-radius: 2px;
}

.volume::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 9px;
  height: 9px;
  margin-top: -3px;
  border-radius: 50%;
  background: var(--text-dim);
}

/* ------------------------------ 错误条 ------------------------------ */

.error-strip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 18px;
  background: rgba(212, 87, 76, 0.1);
  border-top: 1px solid rgba(212, 87, 76, 0.35);
  font-size: 12px;
  color: #e79a92;
}

.small {
  font-size: 12px;
}
</style>
