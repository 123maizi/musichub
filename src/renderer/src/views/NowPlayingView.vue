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
import { useArtistStore } from '../stores/artist'
import { useDownloadStore } from '../stores/downloads'
import { useLibraryStore } from '../stores/library'
import { usePlayerStore } from '../stores/player'
import { bigCoverUrl } from '../utils/cover'
import { cleanIpcError, formatTime } from '../utils/format'

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const downloads = useDownloadStore()
const artistStore = useArtistStore()

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

/* ------------------------------ 歌词翻译 ------------------------------ */

const translateLabel = computed(() => {
  if (player.translating) return '翻译中…'
  if (player.translated) return player.showTranslation ? '隐藏译文' : '显示译文'
  return '翻译歌词'
})

const translateTitle = computed(() =>
  player.translated ? '点击切换译文显示' : '把外语歌词翻成中文'
)

/** 已经翻过就不重复请求（翻译接口有配额），只切换显示 */
async function onTranslate(): Promise<void> {
  const ok = await player.translateCurrentLyric()
  if (!ok && player.translateError) toast.value = player.translateError
}

/* ------------------------------ 歌手 / 专辑跳转 ------------------------------ */

/** 大图要 500px 的，列表里用 120px 的省流量 */
const bigCover = computed(() => bigCoverUrl(player.current?.picUrl))

const openingArtist = ref(false)

/**
 * 拆出可能的歌手名候选。
 *
 * 一首歌的歌手字段常常挤着好几位：酷我用 `&` 拼，QQ 用 `/` 拼，各平台
 * 还用 `、`。但这里刻意「先整串、再逐段」—— 因为有些艺人名字本身就带
 * 分隔符（Tyler, The Creator 带逗号，AC/DC 带斜杠），一上来就拆会把人拆坏。
 * 整串能精确命中就不拆，命中不了才退而求其次。
 */
function artistCandidates(raw: string): string[] {
  const out: string[] = []
  const push = (value: string): void => {
    const name = value.trim()
    if (name && !out.includes(name)) out.push(name)
  }
  push(raw)
  raw.split(/[&、/]/).forEach(push)
  return out.slice(0, 3)
}

const artistTitle = computed(() => {
  const singer = player.current?.singer
  return singer ? `查看「${singer}」的艺人页` : ''
})

async function openArtistPage(): Promise<void> {
  const song = player.current
  if (!song || openingArtist.value) return

  const raw = (song.singer ?? '').trim()
  if (!raw) return

  openingArtist.value = true
  try {
    const names = artistCandidates(raw)
    let picked = null as (typeof artistStore.allArtists)[number] | null

    // 只认「名字完全一致」的结果 —— 多歌手拼成的名字拿去搜，
    // 首条结果十有八九是别人，直接取会开错主页。
    // 比较时忽略大小写与空白：搜索接口返回的大小写未必和歌曲信息一致
    const same = (a: string, b: string): boolean =>
      a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase()

    for (const name of names) {
      await artistStore.search(name)
      const exact = artistStore.allArtists.find((a) => same(a.name, name))
      if (exact) {
        picked = exact
        break
      }
    }

    if (!picked) {
      // 没有完全一致的，退回第一段（通常是主唱）并如实说明是「最接近的」
      const fallbackName = names[1] ?? raw
      await artistStore.search(fallbackName)
      picked = artistStore.allArtists[0] ?? null
      if (picked) toast.value = `没找到完全一致的艺人，先打开最接近的「${picked.name}」`
    }

    if (!picked) {
      toast.value = `没搜到艺人「${names[0] ?? raw}」`
      return
    }

    artistStore.select(picked)
    void router.push('/artist')
  } catch (err) {
    toast.value = cleanIpcError(err)
  } finally {
    openingArtist.value = false
  }
}

/** 点专辑名 → 专辑页（专辑页直接从 query 读，不需要先请求） */
function openAlbumPage(): void {
  const song = player.current
  const name = (song?.albumName ?? '').trim()
  if (!song || !name) return
  void router.push({
    path: '/album',
    query: { name, singer: song.singer, platform: song.platform }
  })
}

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
            :src="bigCover"
            :song="player.current ?? undefined"
            :icon-size="56"
            prefer-resolved
            fallback
          />
        </div>

        <div class="meta">
          <h1 class="ellipsis" :title="player.current?.name">
            {{ player.current?.name ?? '未在播放' }}
          </h1>
          <div class="sub">
            <button
              class="jump"
              :disabled="!player.current || openingArtist"
              :title="artistTitle"
              @click="openArtistPage"
            >
              <span class="ellipsis">{{ player.current?.singer ?? '—' }}</span>
            </button>
            <span v-if="player.current" class="faint"> · {{ platformName }}</span>
          </div>
          <button
            v-if="player.current?.albumName"
            class="jump album faint"
            :title="`查看专辑「${player.current.albumName}」`"
            @click="openAlbumPage"
          >
            <span class="ellipsis">{{ player.current.albumName }}</span>
          </button>
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
        <div v-if="hasLyric" class="lyric-bar">
          <button
            class="translate-btn"
            :class="{ on: player.translated && player.showTranslation }"
            :disabled="player.translating"
            :title="translateTitle"
            @click="onTranslate"
          >
            <AppIcon name="translate" :size="14" />
            <span>{{ translateLabel }}</span>
          </button>
          <span v-if="player.translateError" class="translate-note ellipsis">
            {{ player.translateError }}
          </span>
        </div>

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
            <span class="lyric-main">{{ line.text || '·' }}</span>
            <span v-if="player.showTranslation && line.trans" class="lyric-trans">
              {{ line.trans }}
            </span>
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
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 13px;
  color: var(--text-dim);
}

.album {
  font-size: 12px;
}

/* 可点的歌手 / 专辑：长得像文字，点上去才亮出来 —— 免得满屏都是按钮 */
.jump {
  display: block;
  min-width: 0;
  max-width: 100%;
  padding: 2px 6px;
  margin-left: -6px;
  text-align: left;
  font: inherit;
  color: inherit;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.16s, background 0.16s;
}

.sub .jump {
  color: var(--text);
}

.jump:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--accent);
}

.jump:disabled {
  cursor: default;
  opacity: 0.7;
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

/* ------------------------------ 歌词翻译 ------------------------------ */

.lyric-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px 8px;
  flex: none;
}

.translate-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 12.5px;
  border-radius: 16px;
  background: transparent;
  border: 1px solid var(--line);
  color: var(--text-dim);
  cursor: pointer;
  transition: color 0.18s, background 0.18s, border-color 0.18s;
}

.translate-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.translate-btn.on {
  color: var(--accent);
  border-color: var(--accent);
}

.translate-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.translate-note {
  font-size: 11.5px;
  color: var(--text-faint);
  min-width: 0;
}

/* 译文：比原文小一档、浅一档，读到主句时译文不抢戏 */
.lyric-main {
  display: block;
}

.lyric-trans {
  display: block;
  margin-top: 3px;
  font-size: 12.5px;
  font-weight: 400;
  line-height: 1.5;
  color: var(--text-faint);
  opacity: 0.85;
}

.lyric-line.active .lyric-trans {
  color: var(--text-dim);
  opacity: 1;
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
