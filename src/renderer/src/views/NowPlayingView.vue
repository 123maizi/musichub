<script setup lang="ts">
/**
 * 正在播放页
 *
 * 大封面 + 滚动歌词。歌词高亮跟随播放进度，
 * 点某一行可直接跳到那一句 —— 这是听歌时最常用的两个动作。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { PLATFORM_META, QUALITY_META } from '@shared/constants'
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

/** 歌词为空时给一句友好的提示，而不是留一片空白 */
const hasLyric = computed(() => player.lyricLines.length > 0)

const lyricHint = computed(() => {
  if (hasLyric.value) return ''
  if (player.loading) return '正在获取歌词…'
  if (!player.current) return '还没有开始播放'
  return '这首歌暂时没有歌词'
})

function notify(message: string): void {
  toast.value = message
  setTimeout(() => {
    if (toast.value === message) toast.value = null
  }, 2200)
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

function seekToLine(time: number): void {
  player.seek(time)
}

/* ------------------------------ 操作 ------------------------------ */

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
  if (song) player.addToQueue(song)
}

function back(): void {
  void router.back()
}
</script>

<template>
  <section class="view">
    <header class="bar">
      <button class="ghost small" @click="back">← 返回</button>
      <div class="grow"></div>
      <span v-if="player.urlInfo" class="tag accent" :title="`由音源「${player.urlInfo.sourceName}」提供`">
        {{ qualityLabel }}
      </span>
      <span v-if="player.urlInfo" class="faint src-name ellipsis">{{ player.urlInfo.sourceName }}</span>
    </header>

    <div class="stage">
      <!-- 左：封面与曲目信息 -->
      <div class="left">
        <div class="cover" :class="{ empty: !player.current?.picUrl }">
          <img v-if="player.current?.picUrl" :src="player.current.picUrl" alt="" />
          <span v-else class="mono">MH</span>
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

          <div class="actions">
            <button class="ghost small" :class="{ liked: isFavorite }" :disabled="!player.current" @click="toggleFavorite">
              {{ isFavorite ? '♥ 已收藏' : '♡ 收藏' }}
            </button>
            <button class="ghost small" :disabled="!player.current" @click="downloadCurrent">
              ↓ 下载
            </button>
            <button class="ghost small" :disabled="!player.current" @click="queueCurrent">
              ＋ 加入队列
            </button>
          </div>
        </div>

        <!-- 进度 -->
        <div class="progress-block">
          <div class="time-row mono">
            <span>{{ formatTime(player.currentTime) }}</span>
            <span class="faint">{{ formatTime(player.duration) }}</span>
          </div>
          <div class="bar">
            <i :style="{ width: `${player.progress}%` }" />
          </div>
        </div>

        <!-- 传输控制 -->
        <div class="controls">
          <button class="ghost" title="上一首" :disabled="player.playlist.length === 0" @click="player.playPrev()">⏮</button>
          <button class="play-btn" :title="player.playing ? '暂停' : '播放'" :disabled="!player.current" @click="player.toggle()">
            {{ player.playing ? '❚❚' : '▶' }}
          </button>
          <button class="ghost" title="下一首" :disabled="player.playlist.length === 0" @click="player.playNext()">⏭</button>
          <button class="ghost small mode" :title="player.modeLabel" @click="player.cycleMode()">
            {{ player.modeLabel }}
          </button>
        </div>
      </div>

      <!-- 右：歌词 -->
      <div class="right">
        <div v-if="!hasLyric" class="lyric-empty">
          <span>{{ lyricHint }}</span>
          <span v-if="player.lyricRaw?.tlyric" class="faint">（有翻译歌词可用）</span>
        </div>

        <div v-else ref="lyricBox" class="lyric-box">
          <div class="lyric-pad"></div>
          <div
            v-for="(line, index) in player.lyricLines"
            :key="index"
            class="lyric-line"
            :class="{ active: index === player.currentLyricIndex }"
            :data-line="index"
            @click="seekToLine(line.time)"
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

.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--line-soft);
}

.small {
  font-size: 12px;
}

.src-name {
  max-width: 140px;
  font-size: 11.5px;
}

/* ------------------------------ 主体 ------------------------------ */

.stage {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(280px, 380px) 1fr;
  gap: 32px;
  padding: 28px 32px;
  overflow: hidden;
}

.left {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 0;
  overflow-y: auto;
}

.cover {
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  flex: none;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover.empty .mono {
  font-size: 26px;
  color: var(--text-faint);
  letter-spacing: 0.1em;
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.meta h1 {
  font-size: 20px;
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

.actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.liked {
  color: var(--accent);
}

/* ------------------------------ 进度与控制 ------------------------------ */

.progress-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.time-row {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--text-dim);
}

.progress-block .bar {
  height: 4px;
}

.controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.controls .ghost {
  font-size: 15px;
  padding: 6px 10px;
}

.play-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--accent);
  border-color: var(--accent);
  color: #1a1408;
  font-size: 14px;
  display: grid;
  place-items: center;
  padding: 0;
}

.play-btn:hover:not(:disabled) {
  background: #e0b05c;
  border-color: #e0b05c;
}

.mode {
  margin-left: auto;
}

/* ------------------------------ 歌词 ------------------------------ */

.right {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.lyric-box {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  mask-image: linear-gradient(180deg, transparent, #000 12%, #000 88%, transparent);
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 12%, #000 88%, transparent);
}

.lyric-box::-webkit-scrollbar {
  display: none;
}

.lyric-pad {
  height: 40%;
}

.lyric-line {
  padding: 9px 8px;
  font-size: 15px;
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
  font-weight: 600;
}

.lyric-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-faint);
  font-size: 13px;
}

/* ------------------------------ 其它 ------------------------------ */

.error-strip {
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

.toast {
  position: absolute;
  bottom: 20px;
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
