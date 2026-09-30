<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Song } from '@shared/types/music'
import { PLATFORM_META, QUALITY_META, findFormat, qualityRank } from '@shared/constants'
import { useRouter } from 'vue-router'
import { formatTime } from '../utils/format'
import { useDownloadStore } from '../stores/downloads'
import { useLibraryStore } from '../stores/library'
import AppIcon from './AppIcon.vue'
import PlaylistMenu from './PlaylistMenu.vue'

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
  /** 歌曲加入歌单成功（上层想弹提示可以用） */
  added: [playlist: string, count: number]
}>()

/**
 * 「加入歌单」弹层：整张表只挂一个实例，用 menuSongs 记着当前是为哪几首打开的。
 * 每行各挂一个的话，几百行就是几百个组件，白白吃内存。
 */
const menuOpen = ref(false)
const menuSongs = ref<Song[]>([])
const menuAnchor = ref<HTMLElement | null>(null)

function openPlaylistMenu(songs: Song[], event: MouseEvent): void {
  menuAnchor.value = event.currentTarget as HTMLElement
  menuSongs.value = songs
  menuOpen.value = true
}

function onAddedToPlaylist(playlist: string, count: number): void {
  emit('added', playlist, count)
}

/**
 * 复选框为什么要在 click 上 preventDefault：
 *
 * v-memo 命中时这一行的 DOM 不会被 patch，勾选状态完全由 `:checked` 驱动。
 * 如果放任浏览器自己翻转 checkbox，再叠加「同一 tick 内连点几次」这种极端时序，
 * 就可能出现「框是勾着的、状态里却没有」的错位。
 * 挡掉原生翻转之后，勾与不勾只有一个来源（Vue 绑定的 :checked），
 * 鼠标点、键盘空格、读屏点击走的都是同一条路，不会再错位。
 */
function toggleSelect(song: Song): void {
  const current = props.selectedIds ?? []
  const next = current.includes(song.id)
    ? current.filter((id) => id !== song.id)
    : [...current, song.id]
  emit('update:selectedIds', next)
}

/**
 * 选中集合。
 *
 * 之前每行都调 isSelected()，而它内部是 `selectedIds.includes(id)` ——
 * 140 行 × 每次重渲染都要扫一遍数组，勾选一首歌就是 O(n²)。
 * 换成 Set 之后每行的判断是 O(1)，勾选的成本与已选数量无关。
 */
const selectedSet = computed(() => new Set(props.selectedIds ?? []))

function isSelected(song: Song): boolean {
  return selectedSet.value.has(song.id)
}

/* ------------------------------ 渐进式渲染 ------------------------------ */

/**
 * 一次挂多少行。
 *
 * 实测：搜索结果一次到齐 140 行时，一次性挂载会在主线程上产生一个约 100ms 的长任务
 * （4363 个 DOM 节点 + 140 个 CoverImage 组件），期间界面完全不响应 —— 这就是
 * 「结果出来那一下会卡住」的来源。分批挂载把这个长任务切成几个 <50ms 的小任务，
 * 浏览器在每批之间有机会绘制一帧，首屏行也来得更早。
 *
 * 注意：这不是虚拟滚动，最终**全部行都会真实存在于 DOM 里**，
 * 多选、行内按钮、高亮、移除等能力一个不少；只是挂载节奏被摊开了。
 */
const FIRST_CHUNK = 40
const CHUNK = 40

const renderLimit = ref(0)
let growTimer: ReturnType<typeof setTimeout> | null = null

function stopGrow(): void {
  if (growTimer !== null) {
    clearTimeout(growTimer)
    growTimer = null
  }
}

/** 下一批用 setTimeout(0)：让出一个宏任务，浏览器才有机会在批次之间上屏 */
function growStep(): void {
  growTimer = null
  const total = props.songs.length
  if (renderLimit.value >= total) return
  renderLimit.value = Math.min(renderLimit.value + CHUNK, total)
  if (renderLimit.value < total) growTimer = setTimeout(growStep, 0)
}

function scheduleGrow(): void {
  stopGrow()
  if (renderLimit.value < props.songs.length) growTimer = setTimeout(growStep, 0)
}

/**
 * 列表换了一批（换关键词、翻页、切平台标签、切歌单）就从头分批，
 * 同一批内部不变 —— 否则滚动位置会被反复重建。
 */
watch(
  () => props.songs,
  (list) => {
    renderLimit.value = Math.min(FIRST_CHUNK, list.length)
    scheduleGrow()
  },
  { immediate: true }
)

onBeforeUnmount(stopGrow)

/** 本次已挂载的行（全部挂完时直接复用原数组，不再多复制一份） */
const visibleRows = computed(() => {
  const total = props.songs.length
  return renderLimit.value >= total ? props.songs : props.songs.slice(0, renderLimit.value)
})

/**
 * 每一行的「重绘依赖清单」，配合 v-memo 使用。
 *
 * v-memo 会逐项做 Object.is 比较：清单没变，Vue 直接复用上一轮的 vnode，
 * 连 diff 和 patch 都跳过。于是勾选一行、收藏一首、切歌换高亮时，
 * 代价从「重渲染整张表」降到「只动真正变化的那几行」。
 *
 * 清单必须覆盖模板里用到的每一个外部状态，漏一项就会出现
 * 「数据变了界面不动」。当前行内用到的外部状态一共这 9 项：
 * song 本身、序号、是否正在播放、多选态、选中态、收藏态、
 * 可移除、平台列开关、下载格式文案。
 */
function rowDeps(song: Song, index: number): unknown[] {
  return [
    song,
    index,
    song.id === props.currentId,
    props.selectable,
    selectedSet.value.has(song.id),
    library.isFavorite(song.id),
    props.removable,
    props.showPlatform,
    downloadFormatLabel.value
  ]
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
        v-for="(song, index) in visibleRows"
        :key="song.id"
        v-memo="rowDeps(song, index)"
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
          @click.stop.prevent="toggleSelect(song)"
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
          <button class="ghost tiny" title="播放" @click.stop="emit('play', song)">
            <AppIcon name="play" :size="13" />
          </button>
          <button
            class="ghost tiny"
            :class="{ liked: isFavorite(song) }"
            :title="isFavorite(song) ? '取消收藏' : '收藏到我的喜欢'"
            @click.stop="toggleFavorite(song)"
          >
            <AppIcon :name="isFavorite(song) ? 'heart-filled' : 'heart'" :size="13" :filled="isFavorite(song)" />
          </button>
          <button
            class="ghost tiny"
            title="加入歌单（可以先在上面勾选多首再批量加入）"
            @click.stop="openPlaylistMenu([song], $event)"
          >
            <AppIcon name="playlist" :size="13" />
          </button>
          <button class="ghost tiny" title="加入播放队列" @click.stop="emit('queue', song)">
            <AppIcon name="plus" :size="13" />
          </button>
          <button
            class="ghost tiny"
            :title="`下载为 ${downloadFormatLabel}`"
            @click.stop="emit('download', song)"
          >
            <AppIcon name="download" :size="13" />
          </button>
          <button
            v-if="removable"
            class="ghost tiny danger"
            title="从当前列表移除"
            @click.stop="emit('remove', song)"
          >
            <AppIcon name="close" :size="12" />
          </button>
        </span>
      </div>
    </div>

    <!-- 加入歌单：全表共用一个弹层，位置跟着被点的那个按钮走 -->
    <PlaylistMenu
      v-if="menuOpen"
      :songs="menuSongs"
      :anchor="menuAnchor"
      @close="menuOpen = false"
      @added="onAddedToPlaylist"
    />
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
  /* 操作列按最宽的情况留位：播放 / 收藏 / 歌单 / 队列 / 下载 / 移除 */
  grid-template-columns: 36px minmax(160px, 1.4fr) 56px minmax(100px, 1fr) 62px 52px 176px;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
}

.head.no-platform,
.row.no-platform {
  grid-template-columns: 36px minmax(160px, 1.4fr) minmax(100px, 1fr) 62px 52px 176px;
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
  /*
   * 这里试过 content-visibility: auto + contain-intrinsic-size 的视口裁剪，
   * 实测是负收益，已撤掉。数据（同一产物、同一份 140 行数据、滚完 13 屏）：
   *   开：慢滚平均帧 10.8ms / p95 20.3ms
   *   关：慢滚平均帧 6.65ms / p95 8.6ms
   * 原因：行只有 46px、节点也简单，逐行做可见性判定 + 按需布局
   * 比老老实实一次布局完 140 行更贵。
   */
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
  padding: 4px 7px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
