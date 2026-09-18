<script setup lang="ts">
import type { Song } from '@shared/types/music'
import { PLATFORM_META, QUALITY_META, qualityRank } from '@shared/constants'
import { formatTime } from '../utils/format'
import { useLibraryStore } from '../stores/library'

withDefaults(
  defineProps<{
    songs: Song[]
    loading?: boolean
    emptyText?: string
    /** 是否展示平台列（跨平台聚合时需要） */
    showPlatform?: boolean
    /** 当前正在播放的歌曲 id，用于高亮 */
    currentId?: string
    /** 是否允许从当前列表移除（歌单视图用） */
    removable?: boolean
  }>(),
  {
    loading: false,
    emptyText: '暂无歌曲',
    showPlatform: true,
    currentId: '',
    removable: false
  }
)

const emit = defineEmits<{
  play: [song: Song]
  download: [song: Song]
  queue: [song: Song]
  remove: [song: Song]
}>()

// 收藏状态直接读音乐库，省得往每一层传 props
const library = useLibraryStore()

function isFavorite(song: Song): boolean {
  return library.isFavorite(song.id)
}

async function toggleFavorite(song: Song): Promise<void> {
  await library.toggleFavorite(song)
}

/** 取该曲目可用的最高音质标签 */
function bestQuality(song: Song): string {
  const sorted = [...(song.qualities ?? [])].sort((a, b) => qualityRank(b) - qualityRank(a))
  const top = sorted[0]
  return top ? (QUALITY_META[top]?.short ?? String(top)) : '—'
}

/** 高音质单独上色，方便一眼看出哪首能下无损 */
function isLossless(song: Song): boolean {
  return (song.qualities ?? []).some((q) => qualityRank(q) >= 40)
}
</script>

<template>
  <div class="table">
    <div class="head" :class="{ 'no-platform': !showPlatform }">
      <span class="col-index">#</span>
      <span class="col-main">标题</span>
      <span v-if="showPlatform" class="col-platform">平台</span>
      <span class="col-album">专辑</span>
      <span class="col-quality">音质</span>
      <span class="col-time">时长</span>
      <span class="col-actions"></span>
    </div>

    <div v-if="loading" class="empty">
      <span class="mono">正在检索…</span>
    </div>

    <div v-else-if="songs.length === 0" class="empty">
      <span>{{ emptyText }}</span>
    </div>

    <div v-else class="body">
      <div
        v-for="(song, index) in songs"
        :key="song.id"
        class="row"
        :class="{ 'no-platform': !showPlatform, playing: song.id === currentId }"
        @dblclick="emit('play', song)"
      >
        <span class="col-index mono">{{ String(index + 1).padStart(2, '0') }}</span>

        <div class="col-main">
          <div class="title ellipsis" :title="song.name">{{ song.name }}</div>
          <div class="singer ellipsis" :title="song.singer">{{ song.singer }}</div>
        </div>

        <span v-if="showPlatform" class="col-platform">
          <span class="tag">{{ PLATFORM_META[song.platform]?.short ?? song.platform }}</span>
        </span>

        <span class="col-album ellipsis faint" :title="song.albumName">
          {{ song.albumName || '—' }}
        </span>

        <span class="col-quality">
          <span class="tag" :class="{ accent: isLossless(song) }">{{ bestQuality(song) }}</span>
        </span>

        <span class="col-time mono faint">
          {{ song.duration > 0 ? formatTime(song.duration) : '--:--' }}
        </span>

        <span class="col-actions">
          <button class="ghost tiny" title="播放" @click.stop="emit('play', song)">▶</button>
          <button
            class="ghost tiny"
            :class="{ liked: isFavorite(song) }"
            :title="isFavorite(song) ? '取消收藏' : '收藏到我的喜欢'"
            @click.stop="toggleFavorite(song)"
          >
            {{ isFavorite(song) ? '♥' : '♡' }}
          </button>
          <button class="ghost tiny" title="加入播放队列" @click.stop="emit('queue', song)">＋</button>
          <button class="ghost tiny" title="下载" @click.stop="emit('download', song)">↓</button>
          <button
            v-if="removable"
            class="ghost tiny danger"
            title="从当前列表移除"
            @click.stop="emit('remove', song)"
          >
            ✕
          </button>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 所有行共用同一套栅格，保证列对齐 */
.head,
.row {
  display: grid;
  /* 操作列按最宽的情况留位：播放 / 收藏 / 队列 / 下载 / 移除 */
  grid-template-columns: 36px minmax(160px, 1.4fr) 56px minmax(100px, 1fr) 62px 52px 142px;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
}

.head.no-platform,
.row.no-platform {
  grid-template-columns: 36px minmax(160px, 1.4fr) minmax(100px, 1fr) 62px 52px 142px;
}

/* 已收藏：心形用强调色点亮 */
.liked {
  color: var(--accent);
}

.head {
  height: 34px;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  background: var(--bg);
  z-index: 2;
}

.body {
  overflow-y: auto;
  min-height: 0;
}

.row {
  height: 46px;
  border-bottom: 1px solid var(--line-soft);
  cursor: default;
  transition: background 0.1s;
}

.row:hover {
  background: var(--bg-hover);
}

.row.playing {
  background: var(--accent-soft);
}

.row.playing .title {
  color: var(--accent);
}

.col-index {
  font-size: 11px;
  color: var(--text-faint);
}

.col-main {
  min-width: 0;
  line-height: 1.35;
}

.title {
  font-size: 13px;
  font-weight: 500;
}

.singer {
  font-size: 11.5px;
  color: var(--text-dim);
}

.col-album {
  font-size: 12px;
}

.col-time {
  font-size: 11.5px;
}

.col-actions {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.12s;
}

.row:hover .col-actions {
  opacity: 1;
}

.tiny {
  font-size: 12px;
  padding: 3px 7px;
  line-height: 1.2;
}
</style>
