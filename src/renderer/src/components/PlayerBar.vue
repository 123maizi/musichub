<script setup lang="ts">
/**
 * 底部播放条
 * 图标全部走 AppIcon（内联 SVG），不再使用 ⏮ ▶ ⏭ 这类符号。
 */
import { computed, ref } from 'vue'
import { PLATFORM_META, QUALITY_META } from '@shared/constants'
import AppIcon from './AppIcon.vue'
import PlaylistMenu from './PlaylistMenu.vue'
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

/* ------------------------------ 加入歌单 ------------------------------ */

const menuOpen = ref(false)
const menuAnchor = ref<HTMLElement | null>(null)

function openPlaylistMenu(event: MouseEvent): void {
  if (!player.current) return
  menuAnchor.value = event.currentTarget as HTMLElement
  menuOpen.value = true
}
</script>

<template>
  <footer class="player-bar">
    <!--
      进度条常驻显示。

      之前它是一条 3px 的暗色线，圆点还要悬停才出现 —— 结果就是「没进度条，
      鼠标放上去才看得见进度」。现在改成自己画的进度：底槽常显，
      已播放段用蓝色填充，拖动圆点始终可见。
      仍然保留原生 input[type=range] 负责交互（键盘、拖动、无障碍都靠它），
      只是把它的外观全部换成我们自己的那层。
    -->
    <div class="progress-track" :class="{ seeking }">
      <div class="progress-rail">
        <div class="progress-fill" :style="{ width: `${displayProgress}%` }"></div>
        <div class="progress-knob" :style="{ left: `${displayProgress}%` }"></div>
      </div>
      <input
        class="progress-input"
        type="range"
        min="0"
        max="100"
        step="0.1"
        :value="displayProgress"
        :disabled="!player.current || player.duration <= 0"
        aria-label="播放进度"
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
          <CoverImage
            :src="player.current?.picUrl"
            :song="player.current ?? undefined"
            :icon-size="20"
            fallback
          />
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

        <button
          class="icon-btn"
          :disabled="!player.current"
          title="把当前歌曲加入歌单"
          @click="openPlaylistMenu"
        >
          <AppIcon name="playlist" :size="16" />
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

    <!-- 加入歌单：面板挂在 body 上，位置跟着上面那个按钮 -->
    <PlaylistMenu
      v-if="menuOpen && player.current"
      :songs="[player.current]"
      :anchor="menuAnchor"
      @close="menuOpen = false"
    />
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
  top: 0;
  left: 0;
  right: 0;
  height: 14px;
  display: flex;
  align-items: center;
  padding: 0 14px;
}

/* 底槽：未播放段。常显，不再靠悬停才出现 */
.progress-rail {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: var(--line);
  transition: height 0.14s;
}

/* 已播放段：蓝色 */
.progress-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  background: var(--progress);
  transition: background 0.14s;
}

/* 拖动圆点：始终可见，悬停/拖动时变大 */
.progress-knob {
  position: absolute;
  top: 50%;
  width: 11px;
  height: 11px;
  margin-left: -5.5px;
  border-radius: 50%;
  background: var(--progress);
  border: 2px solid var(--bg-panel);
  transform: translateY(-50%) scale(0.72);
  transition: transform 0.14s;
  pointer-events: none;
}

.progress-track:hover .progress-knob,
.progress-track.seeking .progress-knob {
  transform: translateY(-50%) scale(1);
}

.progress-track:hover .progress-rail,
.progress-track.seeking .progress-rail {
  height: 6px;
}

.progress-track:hover .progress-fill,
.progress-track.seeking .progress-fill {
  background: #5b9bff;
}

/* 真正的交互层：完全透明，盖在上面吃事件 */
.progress-input {
  position: absolute;
  left: 14px;
  right: 14px;
  width: calc(100% - 28px);
  height: 14px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
  opacity: 0;
}

.progress-input:disabled {
  cursor: default;
}

/* 轨道和圆点都已由上层自绘，这里全部隐藏掉外观 */
.progress-input::-webkit-slider-runnable-track {
  height: 14px;
  background: transparent;
}

.progress-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: transparent;
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
