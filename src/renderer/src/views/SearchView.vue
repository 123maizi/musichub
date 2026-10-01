<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { PLATFORM_META } from '@shared/constants'
import type { Song } from '@shared/types/music'
import { SEARCH_EMPTY_SOURCE_OPTIONS, type SearchEmptySource } from '@shared/types/preferences'
import SongTable from '../components/SongTable.vue'
import DownloadFormatPicker from '../components/DownloadFormatPicker.vue'
import SearchHistoryDropdown from '../components/SearchHistoryDropdown.vue'
import { useAlbumStore, type AlbumInfo } from '../stores/album'
import { useArtistStore, type ArtistInfo } from '../stores/artist'
import { useLibraryStore } from '../stores/library'
import { useSearchStore } from '../stores/search'
import { usePlayerStore } from '../stores/player'
import { useDownloadStore } from '../stores/downloads'
import { useSourceStore } from '../stores/sources'

const router = useRouter()
const search = useSearchStore()
const artistStore = useArtistStore()
const albumStore = useAlbumStore()
const player = usePlayerStore()
const downloads = useDownloadStore()
const sources = useSourceStore()
const library = useLibraryStore()

/** 搜索模式：歌曲 / 歌手 / 专辑 —— 三条相互独立的链路 */
const mode = ref<'song' | 'artist' | 'album'>('song')

/** 切模式后如果输入框已有内容，顺手搜一次，省得用户再按回车 */
function switchMode(next: 'song' | 'artist' | 'album'): void {
  if (mode.value === next) return
  mode.value = next
  if (search.keyword.trim()) runSearch()
}

/** 点艺人卡片 → 记住他并进入艺人页 */
function openArtist(artist: ArtistInfo): void {
  artistStore.select(artist)
  void router.push('/artist')
}

/** 点专辑卡片 → 直接带着专辑信息进专辑页（专辑页从 query 读取） */
function openAlbum(album: AlbumInfo): void {
  void router.push({
    path: '/album',
    query: { name: album.name, singer: album.singer, platform: album.platform }
  })
}

const inputEl = ref<HTMLInputElement | null>(null)
const toast = ref<string | null>(null)

const noSource = computed(() => sources.readySources.length === 0)

/* ------------------------------------------------------------------ *
 * 搜索页空态：把「还没搜 / 搜了没结果」的整页留白换成歌曲列表
 *
 * · 数据只从已有的 library store 取（history / favorites / playlists[0]），
 *   不新增任何 IPC
 * · 列表复用 SongTable —— 双击播放、收藏、下载、加队列、封面圆角、
 *   七列栅格全部自动一致
 * · 行数封顶 EMPTY_LIMIT：140 行是硬上限场景，这里绝不能把整份历史渲染出来
 * ------------------------------------------------------------------ */

/** 空态最多渲染多少行（task 要求 20~30） */
const EMPTY_LIMIT = 24

/** 三种来源的元信息直接用共享契约里的（与设置页文案一致） */
const emptySourceOptions = SEARCH_EMPTY_SOURCE_OPTIONS

const emptySourceMeta = computed(
  () =>
    SEARCH_EMPTY_SOURCE_OPTIONS.find((o) => o.value === search.emptySource) ??
    SEARCH_EMPTY_SOURCE_OPTIONS[0]
)

/** 当前来源的完整列表（未截断），用于算「共 N 首」与空判定 */
const emptyAll = computed<Song[]>(() => {
  if (search.emptySource === 'favorites') return library.favorites
  if (search.emptySource === 'playlist') {
    // 多歌单时取第一个（task 允许），并把歌单名写进提示里，避免用户不知道看的是哪个
    const first = library.playlists[0]
    if (!first) return []
    const seen = new Set<string>()
    const merged: Song[] = []
    for (const song of first.songs) {
      if (seen.has(song.id)) continue
      seen.add(song.id)
      merged.push(song)
    }
    return merged
  }
  return library.history.map((entry) => entry.song)
})

/** 实际渲染的行（封顶） */
const emptySongs = computed<Song[]>(() => emptyAll.value.slice(0, EMPTY_LIMIT))

/** 歌单来源时提示里带上歌单名 */
const emptySourceDetail = computed(() => {
  if (search.emptySource !== 'playlist') return emptySourceMeta.value.hint
  const first = library.playlists[0]
  return first ? `歌单「${first.name}」里的歌` : '还没有建过歌单'
})

/** 是否已经搜过（用于区分「还没搜」与「搜了但零结果」） */
const hasSearched = computed(
  () => search.keyword.trim() !== '' || search.platforms.length > 0
)

/** 空态区块的标题 */
const emptyTitle = computed(() => {
  if (search.emptySource === 'favorites') return '我喜欢的'
  if (search.emptySource === 'playlist') return '歌单里的歌'
  return '继续听'
})

/**
 * 什么时候显示空态区块：
 * 歌曲模式 + 不在检索中 + 一条结果都没有。
 * 有结果时这里恒为 false，正常搜索路径的结构与行为完全不变。
 */
const showEmptyPanel = computed(
  () => mode.value === 'song' && !search.loading && search.visibleSongs.length === 0
)

/** 切来源：本地立即生效，落盘交给 store（走 task-12 的 prefs:set） */
function switchEmptySource(next: SearchEmptySource): void {
  void search.setEmptySource(next)
}

/** 空态列表里的播放：队列必须是「这一屏的歌」，不能是空的搜索结果 */
async function playEmptySong(song: Song): Promise<void> {
  await player.play(song, emptySongs.value)
}

onMounted(() => {
  void search.loadEmptySourcePref()
  // 直接进搜索页时 library 可能还没加载过（App 挂载时刷过一次，这里是兜底）
  if (library.favorites.length === 0 && library.history.length === 0) void library.refresh()
})

/**
 * 空态「出现」的那一刻重读一次偏好：
 * 用户多半是刚在设置页改完切回搜索页，进页面时的读取已经拿到新值；
 * 这里再兜一次「从有结果变成空态」的情况（例如清空输入框）。
 */
watch(showEmptyPanel, (now, before) => {
  if (now && !before) void search.loadEmptySourcePref()
})


onMounted(() => {
  inputEl.value?.focus()
})

/* ------------------------------------------------------------------ *
 * 搜索历史下拉（组件归 main-lifecycle，挂载点归本文件）
 *
 * 与空态歌曲列表的优先级（两层互不争抢，写清楚免得后人踩）：
 *   · 下拉是**浮层**，锚在搜索框下方：只要输入框聚焦**且历史里有可选项**就展开
 *     （空输入 → 全部历史；有输入 → 按包含匹配过滤，组件内部自己过滤）
 *   · 空态歌曲列表是**页面内容**：只在「歌曲模式 + 不在检索 + 零结果」时渲染
 *   · 两者可以同时存在（聚焦时下拉浮在列表上方），也可以各自单独存在：
 *       有结果 + 聚焦  → 只有下拉
 *       无结果 + 未聚焦 → 只有空态列表
 *       无结果 + 聚焦   → 下拉浮层 + 下面照常是空态列表
 *     互斥的只有「下拉展开」与「输入框失焦」这一对（失焦即关）。
 * ------------------------------------------------------------------ */
const showHistory = ref(false)

/**
 * 关下拉的延时句柄。
 *
 * 为什么不直接 @blur 立刻关：下拉的每一行是普通元素（不是按钮），
 * 点它会先让输入框 blur、再冒泡出 click —— 立刻关会把浮层在 click 之前
 * 拆掉，于是「点历史项」永远点不中。留 250ms 让这次点击走完。
 */
let historyCloseTimer: ReturnType<typeof setTimeout> | null = null

function openHistory(): void {
  if (historyCloseTimer) {
    clearTimeout(historyCloseTimer)
    historyCloseTimer = null
  }
  showHistory.value = true
}

function closeHistoryNow(): void {
  if (historyCloseTimer) {
    clearTimeout(historyCloseTimer)
    historyCloseTimer = null
  }
  showHistory.value = false
}

function scheduleCloseHistory(): void {
  if (historyCloseTimer) clearTimeout(historyCloseTimer)
  historyCloseTimer = setTimeout(() => {
    historyCloseTimer = null
    showHistory.value = false
  }, 250)
}

/** 从历史里选一条：立即用该词搜索并收起下拉（关键词由组件负责提到最前） */
async function runHistorySearch(keyword: string): Promise<void> {
  const kw = keyword.trim()
  closeHistoryNow()
  if (!kw) return
  search.keyword = kw
  inputEl.value?.blur()
  await search.search(kw)
}

function runSearch(): void {
  // 只有「真正发起一次搜索」（回车 / 点搜索按钮 / 切模式带词重搜）才写历史，
  // 每次键入不写 —— 这是需求点名的
  if (search.keyword.trim()) void window.api.prefs.addSearchHistory(search.keyword.trim())
  closeHistoryNow()
  // 三条链路完全独立：歌曲 / 歌手 / 专辑 各走各的 store
  if (mode.value === 'artist') {
    void artistStore.search(search.keyword)
  } else if (mode.value === 'album') {
    void albumStore.search(search.keyword)
  } else {
    void search.search()
  }
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
          @focus="openHistory"
          @click="openHistory"
          @input="openHistory"
          @blur="scheduleCloseHistory"
        />
        <button class="primary" :disabled="search.loading || !search.keyword.trim()" @click="runSearch">
          {{ search.loading ? '搜索中' : '搜索' }}
        </button>

        <!--
          搜索历史浮层：锚在搜索框下方的绝对定位层（组件内部自己管定位、
          键盘 ↑↓ Enter Esc、单条删除、清空全部、点外关闭）。
          只在这里挂载，不改组件 —— 组件归 main-lifecycle。
        -->
        <SearchHistoryDropdown
          :visible="showHistory"
          :query="search.keyword"
          :anchor="inputEl"
          @pick="runHistorySearch"
          @close="closeHistoryNow"
        />
      </div>

      <div class="meta-row">
        <!-- 搜索模式：歌曲 / 歌手 / 专辑 -->
        <div class="channels">
          <button class="ghost small" :class="{ active: mode === 'song' }" @click="switchMode('song')">
            歌曲
          </button>
          <button class="ghost small" :class="{ active: mode === 'artist' }" @click="switchMode('artist')">
            歌手
          </button>
          <button class="ghost small" :class="{ active: mode === 'album' }" @click="switchMode('album')">
            专辑
          </button>
        </div>

        <div v-if="mode === 'song'" class="channels">
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

        <!--
          结果条数留在工具条里（属于当前筛选上下文）；
          页面级动作只有「多选 / 全部下载」两个，通过 Teleport 注入外壳顶栏右侧。
          下载格式退回内容区：它是「下载之前先选好」的前置设置，属工具条语境，
          放在顶栏会把极简的顶栏挤成一排控件。
        -->
        <span v-if="mode === 'song' && search.totalCount > 0" class="faint small-text">
          共 {{ search.totalCount }} 条 · 耗时 {{ search.cost }}ms
        </span>
        <span v-else-if="mode === 'artist' && artistStore.total > 0" class="faint small-text">
          {{ artistStore.total }} 位艺人 · 耗时 {{ artistStore.cost }}ms
        </span>
        <span v-else-if="mode === 'album' && albumStore.total > 0" class="faint small-text">
          {{ albumStore.total }} 张专辑 · 耗时 {{ albumStore.cost }}ms
        </span>

        <div v-if="mode === 'song'" class="fmt-inline" title="点 ↓ 下载时用这个格式">
          <span class="faint small-text">下载格式</span>
          <DownloadFormatPicker
            compact
            :model-value="downloads.config?.preferQuality"
            :disabled="!downloads.config"
            @update:model-value="downloads.setFormat"
          />
        </div>
      </div>

      <Teleport to="#page-actions">
        <template v-if="mode === 'song'">
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
        </template>
      </Teleport>

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

    <!--
      结果区：歌曲表 / 艺人网格 / 专辑网格。
      空态（歌曲模式 + 无结果 + 不在检索中）时整块让位给下面的推荐区，
      所以此时 .results 不存在 —— .results .row 保持 0，
      而推荐区自己的行在 .recommend 里，两边互不干扰。
    -->
    <div v-if="!(mode === 'song' && showEmptyPanel)" class="results">
      <SongTable
        v-if="mode === 'song'"
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

      <!-- 歌手模式 -->
      <div v-else-if="mode === 'artist'" class="artists">
        <div v-if="artistStore.loading" class="empty">
          <span class="mono">正在检索艺人…</span>
        </div>

        <div v-else-if="artistStore.allArtists.length === 0" class="empty">
          <span>{{ artistStore.error || '输入歌手名开始搜索' }}</span>
        </div>

        <div v-else class="artist-grid">
          <button
            v-for="artist in artistStore.allArtists"
            :key="artist.id"
            class="artist-card"
            :title="`查看「${artist.name}」的歌曲`"
            @click="openArtist(artist)"
          >
            <div class="artist-avatar">
              <CoverImage :src="artist.picUrl" :icon-size="28" />
            </div>
            <div class="artist-name ellipsis">{{ artist.name }}</div>
            <div class="artist-meta">
              <span class="tag">{{ PLATFORM_META[artist.platform]?.short ?? artist.platform }}</span>
              <span v-if="artist.songCount" class="faint">{{ artist.songCount }} 首</span>
            </div>
          </button>
        </div>
      </div>

      <!-- 专辑模式 -->
      <div v-else class="artists">
        <div v-if="albumStore.loading" class="empty">
          <span class="mono">正在检索专辑…</span>
        </div>

        <div v-else-if="albumStore.allAlbums.length === 0" class="empty">
          <span>{{ albumStore.error || '输入专辑名开始搜索' }}</span>
        </div>

        <div v-else class="artist-grid">
          <button
            v-for="album in albumStore.allAlbums"
            :key="album.id"
            class="artist-card"
            :title="`查看专辑「${album.name}」的曲目`"
            @click="openAlbum(album)"
          >
            <div class="album-cover">
              <CoverImage :src="album.picUrl" :icon-size="28" />
            </div>
            <div class="artist-name ellipsis">{{ album.name }}</div>
            <div class="artist-meta">
              <span class="tag">{{ PLATFORM_META[album.platform]?.short ?? album.platform }}</span>
              <span v-if="album.songCount" class="faint">{{ album.songCount }} 首</span>
            </div>
          </button>
        </div>
      </div>
    </div>

    <!--
      搜索页空态：把整页留白换成「继续听 / 我喜欢的 / 歌单里的歌」。
      用独立容器（而不是塞进 .results）有两个原因：
        1. 验收要求空态下 .results .row === 0，同时推荐区行数 > 0，两个断言都要成立
        2. 有结果时这一整块不渲染，正常搜索路径零改动
    -->
    <section v-else class="recommend">
      <div class="recommend-head">
        <div class="recommend-titles">
          <h2 class="recommend-title">{{ emptyTitle }}</h2>
          <span class="faint small-text">
            <template v-if="hasSearched">
              没有找到「{{ search.keyword }}」的内容 · 先听听{{ emptySourceDetail }}
            </template>
            <template v-else>{{ emptySourceDetail }}</template>
            <template v-if="emptyAll.length > emptySongs.length">
              · 共 {{ emptyAll.length }} 首，先显示前 {{ EMPTY_LIMIT }} 首
            </template>
          </span>
        </div>
        <div class="grow"></div>
        <!-- 切换来源入口：常显，所以「来源为空」时也不需要另做一套控件 -->
        <div class="source-switch">
          <button
            v-for="option in emptySourceOptions"
            :key="option.value"
            class="ghost small"
            :class="{ active: search.emptySource === option.value }"
            :title="option.hint"
            @click="switchEmptySource(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div v-if="emptySongs.length > 0" class="recommend-body">
        <SongTable
          :songs="emptySongs"
          :loading="false"
          :current-id="player.current?.id ?? ''"
          :selectable="false"
          :empty-text="`${emptySourceDetail}还是空的`"
          @play="playEmptySong"
          @queue="queueSong"
          @download="downloadSong"
          @search="searchByKeyword"
        />
      </div>

      <!-- 这个来源本来就没歌：给引导文案 + 指向上面的切换入口，不留白 -->
      <div v-else class="recommend-empty">
        <span class="faint">{{ emptySourceDetail }}还是空的</span>
        <span class="faint small-text">
          <template v-if="search.emptySource === 'history'">
            去搜一首听听，或者用上面的按钮换成「我喜欢的 / 歌单歌曲」
          </template>
          <template v-else-if="search.emptySource === 'favorites'">
            在列表里点右侧的心形就能收藏，或者换成「历史播放 / 歌单歌曲」
          </template>
          <template v-else>
            还没有建过歌单 —— 在「我的」页新建一个，或者换成「历史播放 / 我喜欢的」
          </template>
        </span>
        <button class="ghost small" @click="$router.push('/library')">去「我的」看看</button>
      </div>
    </section>

    <!-- 分页 -->
    <!--
      分页行：压到 40px 以内，紧贴列表末尾。
      「回到首页」降级为次要文字链接（它的功能等价于在搜索框里再按一次搜索，
      page 会复位到 1），所以不需要占一个按钮位；功能本身一个没少。
    -->
    <footer v-if="search.totalCount > 0" class="pager">
      <button
        class="pager-link"
        :disabled="search.loading || search.page <= 1"
        @click="search.page = 1; search.search()"
      >
        回到首页
      </button>
      <span class="faint mono">第 {{ search.page }} 页</span>
      <button class="ghost small" :disabled="search.loading" @click="search.nextPage()">
        加载更多
      </button>
    </footer>

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

/* 左右留白由外壳 .page 负责（--page-pad-x），视图不再自加，否则会叠成 80px */
.header {
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.search-box {
  display: flex;
  gap: var(--sp-2);
}

.search-box input {
  flex: 1;
  font-size: var(--fs-base);
  padding: var(--sp-2) var(--sp-3);
}

.search-box button {
  padding: 0 var(--sp-5);
}

.meta-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

/* 分段控件：石刻语言用 1px 刻线分格，不用圆角胶囊 */
.channels {
  display: flex;
  gap: 0;
  padding: 0;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  border-radius: var(--r-ctl);
  overflow: hidden;
}

.channels .ghost {
  border-radius: 0;
  border-color: transparent;
  padding: var(--sp-1) var(--sp-3);
}

.channels .ghost + .ghost {
  border-left: 1px solid var(--hairline);
}

.channels .ghost.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.small-text {
  font-size: var(--fs-xs);
}

/* 搜索页工具条里的下载格式选择：先选格式，再点 ↓ */
.fmt-inline {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-left: var(--sp-1);
}

/* ------------------------------ 平台标签 ------------------------------ */

.tabs {
  display: flex;
  gap: var(--sp-1);
  flex-wrap: wrap;
  padding-bottom: var(--sp-3);
  border-bottom: 1px solid var(--hairline);
}

/* 当前平台用 2px 下刻线标记（与导航柱同一个语言），不做滑动胶囊 */
.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0;
  color: var(--ink-muted);
  padding: var(--sp-1) var(--sp-3);
  font-size: var(--fs-xs);
}

.tab::after {
  content: '';
  position: absolute;
  left: var(--sp-3);
  right: var(--sp-3);
  bottom: -1px;
  height: 2px;
  background: var(--accent);
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform var(--dur-2) var(--ease-out);
}

.tab:hover {
  background: var(--surface-3);
  color: var(--ink);
}

.tab.active {
  background: transparent;
  border-color: transparent;
  color: var(--ink);
}

.tab.active::after {
  transform: scaleX(1);
}

.tab.failed {
  color: var(--danger-text);
}

.tab .mono {
  font-size: var(--fs-xs);
  color: var(--ink-subtle);
}

/* ------------------------------ 提示 ------------------------------ */

.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  margin: var(--sp-4) 0 0;
  padding: var(--sp-2) var(--sp-4);
  font-size: var(--fs-xs);
  border-radius: var(--r-card);
  border: 1px solid var(--hairline);
  background: var(--surface-1);
  color: var(--ink-muted);
}

.notice.warn {
  border-color: var(--accent-ring);
  background: var(--accent-soft);
  color: var(--accent);
}

.notice.err {
  border-color: var(--danger-line);
  background: var(--danger-soft);
  color: var(--danger-text);
}

/* ------------------------------ 结果 ------------------------------ */

.results {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: var(--sp-3) 0 0;
  overflow: hidden;
}

.results :deep(.body) {
  flex: 1;
}

/* ------------------------------ 空态推荐区 ------------------------------ */

/*
 * 「还没搜 / 搜了没结果」时用起来的区块。
 * 结构与 .results 平行：head（标题 + 来源切换）+ body（复用 SongTable）。
 * 行数在脚本里封顶 24，所以这里的滚动成本与 140 行主列表完全不是一个量级。
 */
.recommend {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: var(--sp-3) 0 0;
  overflow: hidden;
}

.recommend-head {
  display: flex;
  align-items: flex-end;
  gap: var(--sp-3);
  padding-bottom: var(--sp-3);
  border-bottom: 1px solid var(--hairline);
}

.recommend-titles {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
}

.recommend-title {
  font-size: var(--fs-md);
}

/* 来源切换：刻线分格的分段控件，与库页 tabs 同一套语言 */
.source-switch {
  display: flex;
  gap: 0;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  border-radius: var(--r-ctl);
  overflow: hidden;
}

.source-switch .ghost {
  border-radius: 0;
  border-color: transparent;
  padding: var(--sp-1) var(--sp-3);
}

.source-switch .ghost + .ghost {
  border-left: 1px solid var(--hairline);
}

.source-switch .ghost.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.recommend-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: var(--sp-2) 0 0;
  overflow: hidden;
}

.recommend-body :deep(.body) {
  flex: 1;
}

/* 该来源本来就没歌：引导文案 + 「去我的看看」，不留白 */
.recommend-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-6) var(--sp-5);
  text-align: center;
  color: var(--ink-subtle);
}

/* ------------------------------ 艺人网格 ------------------------------ */

.artists {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sp-4) 0 var(--sp-6);
}

.artist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: var(--sp-4);
}

.artist-card {
  position: relative;
  z-index: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-4) var(--sp-3) var(--sp-5);
  font-family: inherit;
  color: inherit;
  background: var(--surface-1);
  border: 1px solid var(--hairline);
  border-radius: var(--r-card);
  cursor: pointer;
  /*
   * 卡片 hover 底色改由覆盖层承担：过渡里只剩 border-color（1px 周长，绘制量极小）
   * 与 transform（合成）。原来那版 `transition: background` 每次 hover 都要重绘
   * 整张卡片面积，一屏几十张卡时是白给的开销。
   */
  transition:
    border-color var(--dur-1) var(--ease-out),
    transform var(--dur-1) var(--ease-out);
}

.artist-card::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background-color: var(--surface-3);
  opacity: 0;
  transition: opacity var(--dur-1) var(--ease-out);
  pointer-events: none;
}

.artist-card:hover::before {
  opacity: 1;
}

.artist-card:hover {
  border-color: var(--hairline-strong);
}

.artist-card:active {
  transform: scale(0.98);
}

.artist-avatar {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  display: grid;
  place-items: center;
  color: var(--ink-subtle);
}

/* 专辑封面用方形，与艺人的圆形一眼区分开；石刻没有圆角 */
.album-cover {
  width: 76px;
  height: 76px;
  border-radius: var(--r-card);
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  display: grid;
  place-items: center;
  color: var(--ink-subtle);
}

.artist-name {
  max-width: 100%;
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--ink);
}

.artist-meta {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: var(--fs-xs);
  color: var(--ink-muted);
}

/*
 * 分页行：目标 —— 整行含留白 ≤ 40px，紧贴列表末尾。
 * 之前是 padding 12px 上下 + 居中大间距，整块 ~55px 且留白发散，
 * 视觉上像一块独立的空白区、把列表截断了。
 */
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  padding: var(--sp-1) 0;
  border-top: 1px solid var(--hairline-soft);
  font-size: var(--fs-xs);
}

/* 两个按钮统一 28px 高：≥24px 命中区，同时把整行压在 40px 内 */
.pager button {
  min-height: 28px;
  padding: 0 var(--sp-2);
}

/* 「回到首页」降级成文字链接：仍然可点、可达，但不再占按钮位 */
.pager-link {
  background: transparent;
  border: none;
  color: var(--ink-muted);
  font-size: var(--fs-xs);
  min-height: 24px;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.pager-link:hover:not(:disabled) {
  background: transparent;
  border-color: transparent;
  color: var(--ink);
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
