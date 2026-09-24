<script setup lang="ts">
import { computed } from 'vue'
import type { Song } from '@shared/types/music'
import { PLATFORM_META, QUALITY_META, findFormat, qualityRank } from '@shared/constants'
import { useRouter } from 'vue-router'
import { formatTime } from '../utils/format'
import { useDownloadStore } from '../stores/downloads'
import { useLibraryStore } from '../stores/library'

const props = withDefaults(
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
    /** 是否进入批量选择模式 */
    selectable?: boolean
    /** 已选中的歌曲 id（配合 selectable 使用） */
    selectedIds?: string[]
  }>(),
  {
    loading: false,
    emptyText: '暂无歌曲',
    showPlatform: true,
    currentId: '',
    removable: false,
    selectable: false,
    selectedIds: () => []
  }
)

const emit = defineEmits<{
  play: [song: Song]
  download: [song: Song]
  queue: [song: Song]
  remove: [song: Song]
  /** 点歌手 / 专辑名时，把关键词抛给上层去搜索 */
  search: [keyword: string]
  /** 批量选择结果变化 */
  'update:selectedIds': [ids: string[]]
}>()

/** 切换某一行的选中状态 */
function toggleSelect(song: Song): void {
  const current = props.selectedIds ?? []
  const next = current.includes(song.id)
    ? current.filter((id) => id !== song.id)
    : [...current, song.id]
  emit('update:selectedIds', next)
}

function isSelected(song: Song): boolean {
  return (props.selectedIds ?? []).includes(song.id)
}

// 收藏状态直接读音乐库，省得往每一层传 props
const library = useLibraryStore()
const downloads = useDownloadStore()

/** 下载按钮的提示写着「下载为 MP3 320Kbps」—— 点之前就知道会拿到什么 */
const downloadFormatLabel = computed(() => {
  const f = findFormat(downloads.config?.preferQuality)
  return f ? `${f.format} ${f.rate}` : '音源最佳'
})
const router = useRouter()

/**
 * 打开歌曲所属的专辑。
 *
 * 刻意放在组件内部而不往上抛事件：所有用到这张表的地方
 * （搜索结果、歌单、艺人页、专辑页）都能自动获得这个能力，
 * 不必每个父组件各写一遍。
 */
function openAlbum(song: Song): void {
  const name = song.albumName?.trim()
  if (!name) return
  void router.push({
    path: '/album',
    query: { name, singer: song.singer, platform: song.platform }
  })
}

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
        :class="{
          'no-platform': !showPlatform,
          playing: song.id === currentId,
          selectable,
          selected: selectable && isSelected(song)
        }"
        @dblclick="emit('play', song)"
      >
        <input
          v-if="selectable"
          class="row-check"
          type="checkbox"
          :checked="isSelected(song)"
          @click.stop="toggleSelect(song)"
        />
        <span class="col-index mono">{{ String(index + 1).padStart(2, '0') }}</span>

        <div class="col-main">
          <div class="mini-cover">
            <CoverImage :src="song.picUrl" :song="song" :icon-size="14" fallback />
          </div>
          <div class="title-text">
            <div class="title ellipsis" :title="song.name">{{ song.name }}</div>
            <div
              class="singer ellipsis clickable"
              :title="`搜索歌手：${song.singer}`"
              @click.stop="emit('search', song.singer)"
            >
              {{ song.singer }}
            </div>
          </div>
        </div>

        <span v-if="showPlatform" class="col-platform">
          <span class="tag">{{ PLATFORM_META[song.platform]?.short ?? song.platform }}</span>
        </span>

        <span
          class="col-album ellipsis faint"
          :class="{ clickable: !!song.albumName }"
          :title="song.albumName ? `打开专辑：${song.albumName}` : ''"
          @click.stop="openAlbum(song)"
        >
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
          <button
            class="ghost tiny"
            :title="`下载为 ${downloadFormatLabel}`"
            @click.stop="emit('download', song)"
          >
            ↓
          </button>
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

/* 批量选择：复选框绝对定位，这样不必为它改动整套栅格列定义 */
.row.selectable {
  position: relative;
}

.row-check {
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  margin: 0;
  padding: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

.row.selectable .col-main {
  padding-left: 24px;
}

.row.selected {
  background: var(--accent-soft);
}

.row.selected .title {
  color: var(--accent);
}

.col-index {
  font-size: 11px;
  color: var(--text-faint);
}

.col-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  line-height: 1.35;
}

/* 列表里的小封面：缺图时由 CoverImage 退化成图标，不会出现裂图 */
.mini-cover {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  color: var(--text-faint);
}

.title-text {
  min-width: 0;
}

.title {
  font-size: 13px;
  font-weight: 500;
}

.singer {
  font-size: 11.5px;
  color: var(--text-dim);
}

/* 歌手 / 专辑名可点：点一下就去搜它 */
.clickable {
  cursor: pointer;
  transition: color 0.12s;
}

.clickable:hover {
  color: var(--accent);
  text-decoration: underline;
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
