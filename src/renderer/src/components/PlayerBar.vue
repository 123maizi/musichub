<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePlayerStore } from '../stores/player'
import { useDownloadStore } from '../stores/downloads'
import { useLibraryStore } from '../stores/library'
import { PLATFORM_META, QUALITY_META } from '@shared/constants'
import { formatTime } from '../utils/format'

const player = usePlayerStore()
const downloads = useDownloadStore()
const library = useLibraryStore()

/** 当前歌曲是否已收藏（播放条上的心形） */
const isCurrentFavorite = computed(() =>
  player.current ? library.isFavorite(player.current.id) : false
)

async function toggleFavorite(): Promise<void> {
  const song = player.current
  if (!song) return
  await library.toggleFavorite(song)
}

const seeking = ref(false)
const seekValue = ref(0)

const platformName = computed(() =>
  player.current ? (PLATFORM_META[player.current.platform]?.name ?? player.current.platform) : ''
)

const qualityLabel = computed(() => {
  const q = player.urlInfo?.quality ?? player.quality
  return QUALITY_META[q]?.short ?? String(q)
})

/** 拖动进度条时先用本地值预览，松手才真正 seek */
function onSeekInput(event: Event): void {
  seeking.value = true
  seekValue.value = Number((event.target as HTMLInputElement).value)
}

function onSeekCommit(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  player.seekByPercent(value)
  seeking.value = false
}

const displayProgress = computed(() =>
  seeking.value ? seekValue.value : player.progress
)

const displayTime = computed(() =>
  seeking.value && player.duration > 0
    ? formatTime((seekValue.value / 100) * player.duration)
    : formatTime(player.currentTime)
)

function onVolume(event: Event): void {
  player.setVolume(Number((event.target as HTMLInputElement).value) / 100)
}

async function downloadCurrent(): Promise<void> {
  if (!player.current) return
  await downloads.add([player.current], { quality: player.quality })
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
      <!-- 左：当前曲目（点击进入正在播放页，看大图与歌词） -->
      <router-link
        class="now"
        to="/now-playing"
        title="查看大图与歌词"
        style="text-decoration: none; color: inherit"
      >
        <div class="cover" :class="{ empty: !player.current?.picUrl }">
          <img v-if="player.current?.picUrl" :src="player.current.picUrl" alt="" />
          <span v-else class="mono">MH</span>
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
          <button class="ghost" title="上一首" :disabled="player.playlist.length === 0" @click="player.playPrev()">
            ⏮
          </button>
          <button
            class="play-btn"
            :disabled="!player.current || player.loading"
            :title="player.playing ? '暂停' : '播放'"
            @click="player.toggle()"
          >
            <span v-if="player.loading" class="mono">…</span>
            <span v-else>{{ player.playing ? '❚❚' : '▶' }}</span>
          </button>
          <button class="ghost" title="下一首" :disabled="player.playlist.length === 0" @click="player.playNext()">
            ⏭
          </button>
        </div>

        <div class="time-row mono">
          <span>{{ displayTime }}</span>
          <span class="faint">/ {{ formatTime(player.duration) }}</span>
        </div>
      </div>

      <!-- 右：音质 / 模式 / 音量 / 下载 -->
      <div class="tools">
        <button class="ghost small" :title="player.modeLabel" @click="player.cycleMode()">
          {{ player.modeLabel }}
        </button>

        <span v-if="player.urlInfo" class="tag accent" :title="`由音源「${player.urlInfo.sourceName}」提供`">
          {{ qualityLabel }}
        </span>
        <span v-if="player.urlInfo" class="src-name ellipsis" :title="player.urlInfo.sourceName">
          {{ player.urlInfo.sourceName }}
        </span>

        <button
          class="ghost small"
          :class="{ liked: isCurrentFavorite }"
          :disabled="!player.current"
          :title="isCurrentFavorite ? '取消收藏' : '收藏到我的喜欢'"
          @click="toggleFavorite"
        >
          {{ isCurrentFavorite ? '♥' : '♡' }}
        </button>

        <button
          class="ghost small"
          :disabled="!player.current"
          title="下载当前歌曲"
          @click="downloadCurrent"
        >
          下载
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
  width: 10px;
  height: 10px;
  margin-top: -3.5px;
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
}

.cover {
  flex: none;
  width: 46px;
  height: 46px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover.empty .mono {
  font-size: 11px;
  color: var(--text-faint);
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
  gap: 6px;
}

.buttons .ghost {
  font-size: 13px;
  padding: 4px 8px;
}

.play-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--accent);
  border-color: var(--accent);
  color: #1a1408;
  font-size: 12px;
  display: grid;
  place-items: center;
  padding: 0;
}

.play-btn:hover:not(:disabled) {
  background: #e0b05c;
  border-color: #e0b05c;
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
  gap: 8px;
  min-width: 0;
}

.small {
  font-size: 12px;
  padding: 4px 9px;
}

/* 已收藏：心形点亮 */
.liked {
  color: var(--accent);
}

.src-name {
  max-width: 120px;
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
</style>
