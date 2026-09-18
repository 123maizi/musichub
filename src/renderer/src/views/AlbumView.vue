<script setup lang="ts">
/**
 * 专辑页
 *
 * 结构与艺人页一致：上方专辑信息，下方曲目列表。
 *
 * 实现上刻意选了最轻的路子：**专辑信息全部来自路由 query**，
 * 不额外建 store、也不去调各平台的专辑接口（那五家结构不同且经常改版）。
 * 载入时用「专辑名」搜一次，再按 albumName 精确过滤出这张专辑的歌。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { PLATFORM_META } from '@shared/constants'
import type { Song } from '@shared/types/music'
import AppIcon from '../components/AppIcon.vue'
import SongTable from '../components/SongTable.vue'
import { useDownloadStore } from '../stores/downloads'
import { usePlayerStore } from '../stores/player'
import { cleanIpcError } from '../utils/format'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const downloads = useDownloadStore()

const songs = ref<Song[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const toast = ref<string | null>(null)

/** 专辑信息直接来自 query —— 点专辑名时带过来的 */
const albumName = computed(() => String(route.query.name ?? '').trim())
const singer = computed(() => String(route.query.singer ?? '').trim())
const platform = computed(() => String(route.query.platform ?? ''))

/** 封面与平台标识从曲目里取，省一次接口请求 */
const coverUrl = computed(() => songs.value.find((s) => s.picUrl)?.picUrl)

const platformLabel = computed(() =>
  platform.value ? (PLATFORM_META[platform.value]?.name ?? platform.value) : ''
)

function notify(message: string): void {
  toast.value = message
  setTimeout(() => {
    if (toast.value === message) toast.value = null
  }, 2400)
}

async function loadSongs(): Promise<void> {
  const name = albumName.value
  if (!name) return

  loading.value = true
  error.value = null
  try {
    // 带上歌手名能显著提高命中率（同名专辑不少）
    const keyword = singer.value ? `${name} ${singer.value}` : name
    const res = await window.api.search.search({ keyword, limit: 50 })
    const all = res.platforms.flatMap((group) => group.songs)

    /** 只留这张专辑的歌 —— 搜索结果里会混进名字相似的其他专辑 */
    const exact = all.filter((song) => song.albumName.trim() === name)
    songs.value = exact.length > 0 ? exact : all.filter((s) => s.albumName.includes(name))

    if (songs.value.length === 0) {
      error.value = `没有搜到专辑「${name}」的曲目`
    }
  } catch (err) {
    error.value = cleanIpcError(err)
    songs.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadSongs()
})

/* ------------------------------ 操作 ------------------------------ */

async function playAll(): Promise<void> {
  const first = songs.value[0]
  if (!first) return
  await player.play(first, songs.value)
  notify(`开始播放「${albumName.value}」的 ${songs.value.length} 首歌`)
}

async function downloadAll(): Promise<void> {
  if (songs.value.length === 0) return
  await downloads.add(songs.value)
  notify(`已把 ${songs.value.length} 首加入下载队列`)
}

async function playSong(song: Song): Promise<void> {
  await player.play(song, songs.value)
}

function queueSong(song: Song): void {
  player.addToQueue(song)
  notify(`已加入队列：${song.name}`)
}

async function downloadSong(song: Song): Promise<void> {
  await downloads.add([song])
  notify(`已加入下载：${song.name}`)
}
</script>

<template>
  <section class="view">
    <header class="bar">
      <button class="icon-btn" title="返回" @click="router.back()">
        <AppIcon name="back" :size="18" />
      </button>
      <div class="grow"></div>
      <span v-if="songs.length > 0" class="faint small-text">{{ songs.length }} 首</span>
    </header>

    <div v-if="albumName" class="hero">
      <div class="cover-wrap">
        <CoverImage :src="coverUrl" :icon-size="44" />
      </div>

      <div class="info">
        <div class="kicker">专辑</div>
        <h1 class="ellipsis" :title="albumName">{{ albumName }}</h1>
        <div class="meta">
          <span v-if="singer">{{ singer }}</span>
          <span v-if="platformLabel" class="tag">{{ platformLabel }}</span>
        </div>

        <div class="actions">
          <button class="primary" :disabled="songs.length === 0" @click="playAll">
            <AppIcon name="play" :size="14" />
            <span>播放全部</span>
          </button>
          <button :disabled="songs.length === 0" @click="downloadAll">
            <AppIcon name="download" :size="14" />
            <span>下载全部</span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="error" class="notice err">
      <span class="ellipsis">{{ error }}</span>
    </div>

    <div class="songs">
      <SongTable
        :songs="songs"
        :loading="loading"
        :current-id="player.current?.id ?? ''"
        empty-text="没有找到这张专辑的曲目"
        @play="playSong"
        @queue="queueSong"
        @download="downloadSong"
      />
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

.small-text {
  font-size: 11.5px;
}

/* ------------------------------ 专辑信息 ------------------------------ */

.hero {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 26px 24px;
  border-bottom: 1px solid var(--line);
}

.cover-wrap {
  flex: none;
  width: 132px;
  height: 132px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  color: var(--text-faint);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.4);
}

.info {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}

.kicker {
  font-size: 11px;
  letter-spacing: 0.18em;
  color: var(--accent);
}

.info h1 {
  font-size: 25px;
  font-weight: 600;
  line-height: 1.2;
}

.meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  color: var(--text-dim);
  flex-wrap: wrap;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 18px;
  padding: 7px 16px;
}

/* ------------------------------ 曲目 ------------------------------ */

.songs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 8px 4px 0;
  overflow: hidden;
}

.songs :deep(.body) {
  flex: 1;
}

.notice {
  margin: 10px 18px 0;
  padding: 9px 14px;
  font-size: 12.5px;
  border-radius: var(--radius-sm);
}

.notice.err {
  border: 1px solid rgba(212, 87, 76, 0.3);
  background: rgba(212, 87, 76, 0.08);
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
