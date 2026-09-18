<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Song } from '@shared/types/music'
import SongTable from '../components/SongTable.vue'
import { useSearchStore } from '../stores/search'
import { usePlayerStore } from '../stores/player'
import { useDownloadStore } from '../stores/downloads'
import { useSourceStore } from '../stores/sources'

const search = useSearchStore()
const player = usePlayerStore()
const downloads = useDownloadStore()
const sources = useSourceStore()

const inputEl = ref<HTMLInputElement | null>(null)
const toast = ref<string | null>(null)

const noSource = computed(() => sources.readySources.length === 0)

onMounted(() => {
  inputEl.value?.focus()
})

function runSearch(): void {
  void search.search()
}

function showToast(message: string): void {
  toast.value = message
  setTimeout(() => {
    if (toast.value === message) toast.value = null
  }, 2600)
}

async function playSong(song: Song): Promise<void> {
  await player.play(song, search.visibleSongs)
}

function queueSong(song: Song): void {
  player.addToQueue(song)
  showToast(`已加入队列：${song.name}`)
}

async function downloadSong(song: Song): Promise<void> {
  await downloads.add([song])
  showToast(`已加入下载：${song.name}`)
}

async function downloadAll(): Promise<void> {
  const songs = search.visibleSongs
  if (songs.length === 0) return
  await downloads.add(songs)
  showToast(`已把 ${songs.length} 首加入下载队列`)
}

/** 点歌手 / 专辑名 → 直接以它为新关键词再搜一次 */
async function searchByKeyword(keyword: string): Promise<void> {
  const kw = keyword.trim()
  if (!kw) return
  search.keyword = kw
  inputEl.value?.blur()
  await search.search(kw)
  showToast(`正在搜索：${kw}`)
}

/* ------------------------------ 批量选择 ------------------------------ */

const selectMode = ref(false)
const selectedIds = ref<string[]>([])

/** 当前选中且仍在可见结果里的歌曲 */
const selectedSongs = computed(() =>
  search.visibleSongs.filter((s) => selectedIds.value.includes(s.id))
)

function toggleSelectMode(): void {
  selectMode.value = !selectMode.value
  if (!selectMode.value) selectedIds.value = []
}

async function downloadSelected(): Promise<void> {
  const songs = selectedSongs.value
  if (songs.length === 0) return
  await downloads.add(songs)
  showToast(`已把选中的 ${songs.length} 首加入下载队列`)
  selectedIds.value = []
  selectMode.value = false
}
</script>

<template>
  <section class="view">
    <!-- 顶部搜索区 -->
    <header class="header">
      <div class="search-box">
        <input
          ref="inputEl"
          v-model="search.keyword"
          type="text"
          placeholder="搜索歌曲、歌手、专辑…"
          spellcheck="false"
          @keyup.enter="runSearch"
        />
        <button class="primary" :disabled="search.loading || !search.keyword.trim()" @click="runSearch">
          {{ search.loading ? '搜索中' : '搜索' }}
        </button>
      </div>

      <div class="meta-row">
        <div class="channels">
          <button
            class="ghost small"
            :class="{ active: search.channel === 'builtin' }"
            title="使用内置的五大平台官方接口搜索"
            @click="search.setChannel('builtin')"
          >
            内置接口
          </button>
          <button
            class="ghost small"
            :class="{ active: search.channel === 'source' }"
            title="交给音源脚本自带的搜索能力（仅少数音源支持）"
            @click="search.setChannel('source')"
          >
            音源自带
          </button>
        </div>

        <div class="grow"></div>

        <span v-if="search.totalCount > 0" class="faint small-text">
          共 {{ search.totalCount }} 条 · 耗时 {{ search.cost }}ms
        </span>

        <button
          :class="selectMode ? 'primary small' : 'ghost small'"
          :disabled="search.totalCount === 0"
          @click="toggleSelectMode"
        >
          {{ selectMode ? '退出多选' : '多选' }}
        </button>

        <template v-if="selectMode">
          <span class="faint small-text">已选 {{ selectedIds.length }} 首</span>
          <button class="primary small" :disabled="selectedIds.length === 0" @click="downloadSelected">
            下载所选
          </button>
        </template>

        <button
          v-else
          class="ghost small"
          :disabled="search.totalCount === 0"
          @click="downloadAll"
        >
          全部下载
        </button>
      </div>

      <!-- 平台筛选 -->
      <div v-if="search.platformTabs.length > 0" class="tabs">
        <button
          class="tab"
          :class="{ active: search.activePlatform === 'all' }"
          @click="search.activePlatform = 'all'"
        >
          全部 <span class="mono">{{ search.totalCount }}</span>
        </button>
        <button
          v-for="tab in search.platformTabs"
          :key="tab.id"
          class="tab"
          :class="{ active: search.activePlatform === tab.id, failed: !!tab.error }"
          :title="tab.error ? `该平台失败：${tab.error}` : ''"
          @click="search.activePlatform = tab.id"
        >
          {{ tab.name }} <span class="mono">{{ tab.count }}</span>
        </button>
      </div>
    </header>

    <!-- 提示条 -->
    <div v-if="noSource" class="notice warn">
      <span><strong>还没有可用音源。</strong>搜索可以正常用，但试听与下载需要先导入音源。</span>
      <button class="ghost small" @click="$router.push('/sources')">去导入音源</button>
    </div>

    <div v-else-if="search.error" class="notice err">
      <span class="ellipsis">{{ search.error }}</span>
      <button class="ghost small" @click="search.search()">重试</button>
    </div>

    <div v-if="search.failedPlatforms.length > 0 && !search.error" class="notice">
      <span class="ellipsis">
        以下平台本次未返回结果：{{ search.failedPlatforms.map((p) => p.providerName).join('、') }}
      </span>
    </div>

    <!-- 结果表 -->
    <div class="results">
      <SongTable
        v-model:selected-ids="selectedIds"
        :songs="search.visibleSongs"
        :loading="search.loading"
        :current-id="player.current?.id ?? ''"
        :selectable="selectMode"
        empty-text="输入关键词开始搜索"
        @play="playSong"
        @queue="queueSong"
        @download="downloadSong"
        @search="searchByKeyword"
      />
    </div>

    <!-- 分页 -->
    <footer v-if="search.totalCount > 0" class="pager">
      <button
        class="ghost small"
        :disabled="search.loading || search.page <= 1"
        @click="search.page = 1; search.search()"
      >
        回到首页
      </button>
      <span class="faint small-text mono">第 {{ search.page }} 页</span>
      <button class="ghost small" :disabled="search.loading" @click="search.nextPage()">
        加载更多
      </button>
    </footer>

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

.header {
  padding: 18px 18px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search-box {
  display: flex;
  gap: 8px;
}

.search-box input {
  flex: 1;
  font-size: 14px;
  padding: 10px 14px;
}

.search-box button {
  padding: 0 22px;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.channels {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.channels .ghost {
  border-radius: 4px;
  padding: 4px 10px;
}

.channels .ghost.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.small-text {
  font-size: 11.5px;
}

/* ------------------------------ 平台标签 ------------------------------ */

.tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-dim);
  padding: 5px 11px;
  font-size: 12px;
}

.tab:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.tab.active {
  background: var(--accent-soft);
  border-color: rgba(212, 162, 76, 0.3);
  color: var(--accent);
}

.tab.failed {
  color: var(--danger);
}

.tab .mono {
  font-size: 11px;
  opacity: 0.7;
}

/* ------------------------------ 提示 ------------------------------ */

.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 12px 18px 0;
  padding: 9px 14px;
  font-size: 12.5px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  background: var(--bg-panel);
  color: var(--text-dim);
}

.notice.warn {
  border-color: rgba(212, 162, 76, 0.3);
  background: var(--accent-soft);
  color: #e0bd7a;
}

.notice.err {
  border-color: rgba(212, 87, 76, 0.3);
  background: rgba(212, 87, 76, 0.08);
  color: #e79a92;
}

/* ------------------------------ 结果 ------------------------------ */

.results {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 4px 0;
  overflow: hidden;
}

.results :deep(.body) {
  flex: 1;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 10px;
  border-top: 1px solid var(--line-soft);
}

/* ------------------------------ toast ------------------------------ */

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
  color: var(--text);
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
