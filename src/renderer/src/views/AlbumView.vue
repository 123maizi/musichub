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
    <!-- 页面标题由外壳顶栏渲染；播放/下载这两个页面级动作注入顶栏右侧 -->
    <Teleport to="#page-actions">
      <button class="primary small" :disabled="songs.length === 0" @click="playAll">
        <AppIcon name="play" :size="14" />
        <span>播放全部</span>
      </button>
      <button class="ghost small" :disabled="songs.length === 0" @click="downloadAll">
        <AppIcon name="download" :size="14" />
        <span>下载全部</span>
      </button>
    </Teleport>

    <div v-if="albumName" class="hero">
      <div class="cover-wrap">
        <CoverImage :src="coverUrl" :icon-size="44" />
      </div>

      <div class="info">
        <div class="kicker eyebrow">专辑</div>
        <h1 class="ellipsis" :title="albumName">{{ albumName }}</h1>
        <div class="meta">
          <span v-if="singer">{{ singer }}</span>
          <span v-if="platformLabel" class="tag">{{ platformLabel }}</span>
          <span v-if="songs.length > 0" class="faint">{{ songs.length }} 首</span>
        </div>

        <div class="actions">
          <button class="ghost small" title="返回上一页" @click="router.back()">
            <AppIcon name="back" :size="14" />
            <span>返回</span>
          </button>
        </div>
      </div>
    </div>

    <div v-else class="empty">
      <span>还没有选择专辑</span>
      <button class="ghost small" @click="router.push('/search')">去搜索</button>
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

    <Transition name="toast-center">
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

/* ------------------------------ 专辑信息 ------------------------------ */

.hero {
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  padding: var(--sp-5) 0;
  border-bottom: 1px solid var(--hairline);
}

/* 石刻：零圆角、零阴影，靠 1px 刻线围出封面 */
.cover-wrap {
  flex: none;
  width: 132px;
  height: 132px;
  border-radius: var(--r-card);
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  display: grid;
  place-items: center;
  color: var(--ink-subtle);
}

.info {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
}

/* 碑刻小标签：全局 .eyebrow 负责衬线/大写/疏排，这里只给强调色 */
.kicker {
  color: var(--accent);
}

.info h1 {
  font-size: var(--fs-lg);
}

.meta {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  font-size: var(--fs-xs);
  color: var(--ink-muted);
  flex-wrap: wrap;
}

.actions {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
}

.actions button {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
}

/* ------------------------------ 曲目 ------------------------------ */

.songs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: var(--sp-2) 0 0;
  overflow: hidden;
}

.songs :deep(.body) {
  flex: 1;
}

.notice {
  margin: var(--sp-3) 0 0;
  padding: var(--sp-2) var(--sp-4);
  font-size: var(--fs-xs);
  border-radius: var(--r-card);
}

.notice.err {
  border: 1px solid var(--danger-line);
  background: var(--danger-soft);
  color: var(--danger-text);
}

.toast {
  position: absolute;
  bottom: var(--sp-5);
  left: 50%;
  transform: translateX(-50%);
  padding: var(--sp-2) var(--sp-4);
  border-radius: var(--r-card);
  background: var(--surface-1);
  border: 1px solid var(--hairline-strong);
  font-size: var(--fs-xs);
  color: var(--ink);
}
</style>
