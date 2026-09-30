<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { Song } from '@shared/types/music'
import AppIcon from '../components/AppIcon.vue'
import PlaylistMenu from '../components/PlaylistMenu.vue'
import SongTable from '../components/SongTable.vue'
import { useDownloadStore } from '../stores/downloads'
import { useLibraryStore } from '../stores/library'
import { usePlayerStore } from '../stores/player'
import { useSearchStore } from '../stores/search'

const router = useRouter()
const library = useLibraryStore()
const player = usePlayerStore()
const downloads = useDownloadStore()
const searchStore = useSearchStore()

/** 点歌手 / 专辑名 → 跳到搜索页并直接搜它 */
async function searchByKeyword(keyword: string): Promise<void> {
  const kw = keyword.trim()
  if (!kw) return
  searchStore.keyword = kw
  await router.push('/search')
  await searchStore.search(kw)
}

type Tab = 'favorites' | 'history' | 'playlists'

const tabs = [
  { id: 'favorites' as const, label: '我的喜欢' },
  { id: 'history' as const, label: '历史播放' },
  { id: 'playlists' as const, label: '歌单' }
]

const tab = ref<Tab>('favorites')
const activePlaylistId = ref<string | null>(null)
const newName = ref('')
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const toast = ref<string | null>(null)
/** 批量勾选的歌曲 id（列表在下面，多选用得着） */
const selectedIds = ref<string[]>([])
const playlistMenuOpen = ref(false)
const playlistMenuAnchor = ref<HTMLElement | null>(null)

const activePlaylist = computed(
  () => library.playlists.find((p) => p.id === activePlaylistId.value) ?? null
)

/** 当前页要展示的歌曲 */
const songs = computed<Song[]>(() => {
  if (tab.value === 'favorites') return library.favorites
  if (tab.value === 'history') return library.history.map((entry) => entry.song)
  return activePlaylist.value?.songs ?? []
})

const emptyText = computed(() => {
  if (tab.value === 'favorites') return '还没有收藏的歌 —— 在搜索页点歌曲右侧的心形按钮即可收藏'
  if (tab.value === 'history') return '还没有播放记录，去搜索页听一首吧'
  if (!activePlaylist.value) return '左侧选择一个歌单，或者先新建一个'
  return '这个歌单还是空的 —— 去搜索页 /「我的喜欢」点歌曲右侧的歌单按钮，或勾选多首后批量加入'
})

/** 勾选的歌曲实体（批量加入歌单要用完整对象，不能只有 id） */
const selectedSongs = computed(() => songs.value.filter((s) => selectedIds.value.includes(s.id)))

function clearSelection(): void {
  selectedIds.value = []
}

function switchTab(next: Tab): void {
  tab.value = next
  clearSelection()
}

function selectPlaylist(id: string): void {
  activePlaylistId.value = id
  clearSelection()
}

onMounted(() => {
  void library.refresh()
})

function notify(message: string): void {
  toast.value = message
  setTimeout(() => {
    if (toast.value === message) toast.value = null
  }, 2400)
}

/* ------------------------------ 列表操作 ------------------------------ */

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

async function downloadAll(): Promise<void> {
  const list = songs.value
  if (list.length === 0) return
  await downloads.add(list)
  notify(`已把 ${list.length} 首加入下载队列`)
}

/* ------------------------------ 歌单 ------------------------------ */

async function createPlaylist(): Promise<void> {
  const name = newName.value.trim()
  if (!name) return
  await library.createPlaylist(name)
  newName.value = ''
  notify(`已创建歌单：${name}`)
}

function startRename(id: string, current: string): void {
  renamingId.value = id
  renameValue.value = current
}

async function commitRename(): Promise<void> {
  if (!renamingId.value) return
  await library.renamePlaylist(renamingId.value, renameValue.value)
  renamingId.value = null
}

async function removePlaylist(id: string, name: string): Promise<void> {
  if (!window.confirm(`确定删除歌单「${name}」？歌曲本身不会被删除。`)) return
  await library.removePlaylist(id)
  if (activePlaylistId.value === id) activePlaylistId.value = null
  notify('歌单已删除')
}

async function removeFromPlaylist(song: Song): Promise<void> {
  const playlist = activePlaylist.value
  if (!playlist) return
  await library.removeSongsFromPlaylist(playlist.id, [song.id])
  notify(`已从歌单移除：${song.name}`)
}

async function clearCurrentPlaylist(): Promise<void> {
  const playlist = activePlaylist.value
  if (!playlist || playlist.songs.length === 0) return
  if (!window.confirm(`清空歌单「${playlist.name}」里的全部歌曲？`)) return
  await library.clearPlaylist(playlist.id)
  notify('歌单已清空')
}

/* ------------------------------ 批量操作 ------------------------------ */

/** 勾选若干首 → 一次性塞进歌单（歌单满了才用得顺手，一首一首点太苦） */
function openBulkPlaylistMenu(event: MouseEvent): void {
  if (selectedSongs.value.length === 0) return
  playlistMenuAnchor.value = event.currentTarget as HTMLElement
  playlistMenuOpen.value = true
}

function onAddedToPlaylist(playlist: string, count: number): void {
  notify(`已把 ${count} 首加入《${playlist}》`)
  clearSelection()
}

async function removeSelectedFromPlaylist(): Promise<void> {
  const playlist = activePlaylist.value
  if (!playlist || selectedIds.value.length === 0) return
  const count = selectedIds.value.length
  await library.removeSongsFromPlaylist(playlist.id, [...selectedIds.value])
  clearSelection()
  notify(`已从歌单移除 ${count} 首`)
}
</script>

<template>
  <section class="view">
    <header class="header">
      <!-- 页面标题由外壳顶栏渲染（route.meta.title）；这里只留工具条 -->
      <div class="actions">
        <div class="tabs">
          <button
            v-for="item in tabs"
            :key="item.id"
            class="ghost small"
            :class="{ active: tab === item.id }"
            @click="switchTab(item.id)"
          >
            {{ item.label }}
          </button>
        </div>
        <div class="grow"></div>
        <span class="faint small-text">
          收藏 {{ library.stats.favorites }} · 历史 {{ library.stats.history }} · 歌单
          {{ library.stats.playlists }}
        </span>
      </div>

      <!-- 勾选了歌曲才出现的批量条：加入歌单是这里的头等大事 -->
      <div v-if="selectedIds.length > 0" class="bulk">
        <span class="small-text">已选 {{ selectedIds.length }} 首</span>
        <button class="ghost small" @click="openBulkPlaylistMenu">
          <AppIcon name="playlist" :size="13" />
          <span>加入歌单</span>
        </button>
        <button
          v-if="tab === 'playlists' && activePlaylist"
          class="ghost small danger"
          @click="removeSelectedFromPlaylist"
        >
          <AppIcon name="close" :size="12" />
          <span>移出歌单</span>
        </button>
        <div class="grow"></div>
        <button class="ghost small" @click="clearSelection">取消选择</button>
      </div>
    </header>

    <!-- 页面级动作注入外壳顶栏 -->
    <Teleport to="#page-actions">
      <button class="ghost small" :disabled="songs.length === 0" @click="downloadAll">
        全部下载
      </button>
      <button
        v-if="tab === 'favorites' && library.favorites.length > 0"
        class="ghost small danger"
        @click="library.clearFavorites()"
      >
        清空收藏
      </button>
      <button
        v-if="tab === 'history' && library.history.length > 0"
        class="ghost small danger"
        @click="library.clearHistory()"
      >
        清空历史
      </button>
      <button
        v-if="tab === 'playlists' && activePlaylist && activePlaylist.songs.length > 0"
        class="ghost small danger"
        @click="clearCurrentPlaylist"
      >
        清空歌单
      </button>
    </Teleport>

    <div class="body" :class="{ split: tab === 'playlists' }">
      <!-- 歌单侧栏 -->
      <aside v-if="tab === 'playlists'" class="playlists">
        <div class="new-playlist">
          <input v-model="newName" placeholder="新建歌单…" spellcheck="false" @keyup.enter="createPlaylist" />
          <button class="ghost small" :disabled="!newName.trim()" @click="createPlaylist">创建</button>
        </div>

        <div class="pl-list">
          <div
            v-for="p in library.playlists"
            :key="p.id"
            class="pl-item"
            :class="{ active: p.id === activePlaylistId }"
            @click="selectPlaylist(p.id)"
          >
            <input
              v-if="renamingId === p.id"
              v-model="renameValue"
              class="rename-input"
              @keyup.enter="commitRename"
              @blur="commitRename"
              @click.stop
            />
            <template v-else>
              <span class="pl-name ellipsis" :title="p.name">{{ p.name }}</span>
              <span class="pl-count mono">{{ p.songs.length }}</span>
            </template>

            <div v-if="renamingId !== p.id" class="pl-ops">
              <button class="ghost tiny" title="重命名" @click.stop="startRename(p.id, p.name)">✎</button>
              <button class="ghost tiny danger" title="删除歌单" @click.stop="removePlaylist(p.id, p.name)">✕</button>
            </div>
          </div>

          <div v-if="library.playlists.length === 0" class="empty-hint faint">
            还没有歌单，上面输入名字创建一个
          </div>
        </div>
      </aside>

      <!-- 歌曲列表 -->
      <div class="songs">
        <SongTable
          :songs="songs"
          :current-id="player.current?.id ?? ''"
          :empty-text="emptyText"
          :removable="tab === 'playlists'"
          selectable
          :selected-ids="selectedIds"
          @update:selected-ids="selectedIds = $event"
          @play="playSong"
          @queue="queueSong"
          @download="downloadSong"
          @remove="removeFromPlaylist"
          @search="searchByKeyword"
          @added="onAddedToPlaylist"
        />

        <!-- 歌单视图下的提示 -->
        <div v-if="tab === 'playlists' && activePlaylist && songs.length > 0" class="hint-bar">
          <span class="faint small-text">
            在「{{ activePlaylist.name }}」中 · 勾选多首可批量移出，或加入别的歌单
          </span>
        </div>
      </div>
    </div>

    <!-- 批量加入歌单：面板挂在 body 上，位置跟着「加入歌单」按钮 -->
    <PlaylistMenu
      v-if="playlistMenuOpen"
      :songs="selectedSongs"
      :anchor="playlistMenuAnchor"
      @close="playlistMenuOpen = false"
      @added="onAddedToPlaylist"
    />

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

/* 左右留白由外壳 .page 负责，视图不再自加 */
.header {
  padding: 0 0 var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  border-bottom: 1px solid var(--hairline);
}

.small-text {
  font-size: var(--fs-xs);
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

/* 分段控件：石刻语言用刻线分格，不用圆角胶囊 */
.tabs {
  display: flex;
  gap: 0;
  padding: 0;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  border-radius: var(--r-ctl);
  overflow: hidden;
}

.tabs .ghost {
  border-radius: 0;
  border-color: transparent;
  padding: var(--sp-1) var(--sp-3);
}

.tabs .ghost + .ghost {
  border-left: 1px solid var(--hairline);
}

.tabs .ghost.active {
  background: var(--accent-soft);
  color: var(--accent);
}

/* 批量条：勾选后才出现，压在工具条下方 */
.bulk {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--hairline);
  border-radius: var(--r-card);
  background: var(--surface-1);
}

.bulk button {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
}

/* ------------------------------ 主体 ------------------------------ */

.body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.body.split .playlists {
  width: 240px;
  flex: none;
  border-right: 1px solid var(--hairline);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.songs {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: var(--sp-2) 0 0;
  overflow: hidden;
}

.songs :deep(.body) {
  flex: 1;
}

.hint-bar {
  padding: var(--sp-2) var(--sp-4);
  border-top: 1px solid var(--hairline-soft);
}

/* ------------------------------ 歌单 ------------------------------ */

.new-playlist {
  display: flex;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border-bottom: 1px solid var(--hairline-soft);
}

.new-playlist input {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-xs);
  padding: var(--sp-1) var(--sp-2);
}

.pl-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-2);
}

.pl-item {
  position: relative;
  z-index: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-card);
  cursor: pointer;
}

/*
 * 歌单项的 hover / 选中底色同样改覆盖层 + opacity：
 * 这个列表在歌单多的时候能到几十项，逐项重绘 background 没有意义。
 * ::before 管 hover，::after 管选中，active 优先（保持原来的观感）。
 */
.pl-item::before,
.pl-item::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--dur-1) var(--ease-out);
}

.pl-item::before {
  background-color: var(--surface-3);
}

.pl-item:hover::before {
  opacity: 1;
}

/* 选中：2px 左刻线 + 极淡底，与列表行同一套语言 */
.pl-item::after {
  background-color: color-mix(in srgb, var(--accent) 7%, transparent);
  background-image: linear-gradient(to right, var(--accent) 0 2px, transparent 2px);
}

.pl-item.active::after {
  opacity: 1;
}

.pl-item.active::before {
  opacity: 0;
}

.pl-item.active .pl-name {
  color: var(--accent);
}

.pl-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  color: var(--ink);
}

.pl-count {
  font-size: var(--fs-xs);
  color: var(--ink-subtle);
}

.pl-ops {
  display: flex;
  gap: var(--sp-1);
  opacity: 0;
  transition: opacity var(--dur-1) var(--ease-out);
}

.pl-item:hover .pl-ops,
.pl-item:focus-within .pl-ops {
  opacity: 1;
}

.rename-input {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-xs);
  padding: var(--sp-1) var(--sp-2);
}

/* 命中区 ≥24px（WCAG 2.5.8） */
.tiny {
  font-size: var(--fs-xs);
  min-width: 24px;
  min-height: 24px;
  padding: var(--sp-1);
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.empty-hint {
  padding: var(--sp-5) var(--sp-3);
  font-size: var(--fs-xs);
  color: var(--ink-subtle);
  text-align: center;
  line-height: var(--lh-base);
}

/* ------------------------------ toast ------------------------------ */

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
