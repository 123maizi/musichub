<script setup lang="ts">
/**
 * 艺人页
 *
 * 上方是艺人头像与资料，下方是他的歌曲列表。
 *
 * 这里有个刻意的取舍：**不去调各平台的「歌手全部歌曲」接口**。
 * 那类接口五家各不相同、还经常改版，维护成本极高。
 * 改用「拿歌手名当关键词搜歌曲」—— 所有平台都支持，且拿到的就是可播放的条目。
 * 代价是搜索结果里会混入翻唱和合唱，所以下面做了一层歌手名过滤。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { PLATFORM_META } from '@shared/constants'
import type { Song } from '@shared/types/music'
import AppIcon from '../components/AppIcon.vue'
import SongTable from '../components/SongTable.vue'
import { useArtistStore } from '../stores/artist'
import { useDownloadStore } from '../stores/downloads'
import { usePlayerStore } from '../stores/player'
import { cleanIpcError } from '../utils/format'

const router = useRouter()
const artistStore = useArtistStore()
const player = usePlayerStore()
const downloads = useDownloadStore()

/**
 * 点歌手名时的行为：直接打开那位艺人的主页。
 *
 * 列表里可能混着合唱曲，点到的未必是当前这位 —— 是别人就切过去。
 * 这里不跳路由，因为本来就在艺人页：selected 一变，
 * 下面的 watch 会自动重新加载他的歌曲。
 */
async function searchThisArtist(name: string): Promise<void> {
  const kw = name.trim()
  if (!kw) return
  if (kw === artistStore.selected?.name) {
    notify(`当前就是「${kw}」`)
    return
  }
  notify(`正在打开「${kw}」的主页…`)
  await artistStore.openByName(kw)
}

const songs = ref<Song[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const toast = ref<string | null>(null)

const artist = computed(() => artistStore.selected)

const platformName = computed(() =>
  artist.value ? (PLATFORM_META[artist.value.platform]?.name ?? artist.value.platform) : ''
)

/** 艺人资料的展示片段 */
const metaParts = computed(() => {
  const a = artist.value
  if (!a) return []
  const parts: string[] = []
  if (a.alias) parts.push(a.alias)
  if (a.songCount) parts.push(`${a.songCount} 首歌`)
  if (a.albumCount) parts.push(`${a.albumCount} 张专辑`)
  return parts
})

function notify(message: string): void {
  toast.value = message
  setTimeout(() => {
    if (toast.value === message) toast.value = null
  }, 2400)
}

/* ------------------------------ 魔改版本过滤 ------------------------------ */

/**
 * 魔改版本特征词。
 *
 * 搜「周杰伦」会涌出大量 DJ 版、伴奏版、串烧 —— 这些不是用户想听的。
 * 做成可关的开关而不是硬过滤：偶尔确实有人想找伴奏，
 * 一刀切掉反而堵死了正当需求。
 */
const JUNK_WORDS = [
  'dj',
  '伴奏',
  'karaoke',
  'ktv',
  '串烧',
  '慢摇',
  '喊麦',
  '土嗨',
  '广场舞',
  '电音版',
  '加速版',
  '减速版',
  '降调',
  '升调',
  '魔改',
  '重低音',
  '车载',
  '抖音版',
  '网红版',
  '改编版'
]

function isJunk(song: Song): boolean {
  const name = song.name.toLowerCase()
  return JUNK_WORDS.some((word) => name.includes(word))
}

/** 是否显示被过滤掉的魔改版本 */
const showJunk = ref(false)

/** 未过滤的完整结果 */
const rawSongs = ref<Song[]>([])

/** 被过滤掉的数量，用于提示用户「隐藏了多少条」 */
const hiddenCount = ref(0)

/** 按当前开关把结果写进 songs */
function applyFilter(): void {
  const clean = rawSongs.value.filter((song) => !isJunk(song))
  hiddenCount.value = rawSongs.value.length - clean.length
  const base = showJunk.value ? rawSongs.value : clean
  // 全被过滤掉时退回原始结果 —— 宁可看到杂的，也别给个空列表
  songs.value = base.length > 0 ? base : rawSongs.value
}

function toggleJunk(): void {
  showJunk.value = !showJunk.value
  applyFilter()
  notify(showJunk.value ? '已显示全部版本' : `已隐藏 ${hiddenCount.value} 首魔改版本`)
}

/** 拉取该艺人的歌曲 */
async function loadSongs(): Promise<void> {
  const current = artist.value
  if (!current) return

  loading.value = true
  error.value = null
  try {
    const res = await window.api.search.search({ keyword: current.name, limit: 50 })
    const all = res.platforms.flatMap((group) => group.songs)

    /**
     * 只保留真正的这位歌手 —— 搜歌手名会把翻唱、合唱、同名曲一并返回。
     * 过滤后若为空（某些平台歌手名写法不一致），就退回全部结果，有总比没有强。
     */
    const byThisArtist = all.filter((song) => song.singer.includes(current.name))
    rawSongs.value = byThisArtist.length > 0 ? byThisArtist : all
    applyFilter()

    if (songs.value.length === 0) {
      error.value = `没有搜到「${current.name}」的歌曲，可能该平台没有收录`
    }
  } catch (err) {
    error.value = cleanIpcError(err)
    rawSongs.value = []
    songs.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadSongs()
})

// 从一位艺人切到另一位时重新拉歌
watch(
  () => artist.value?.id,
  () => {
    void loadSongs()
  }
)

/* ------------------------------ 操作 ------------------------------ */

async function playAll(): Promise<void> {
  const first = songs.value[0]
  if (!first) return
  await player.play(first, songs.value)
  notify(`开始播放「${artist.value?.name}」的 ${songs.value.length} 首歌`)
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

      <span v-if="artist && songs.length > 0" class="faint small-text">
        {{ songs.length }} 首歌<template v-if="hiddenCount > 0 && !showJunk">
          · 已滤掉 {{ hiddenCount }} 首魔改</template
        >
      </span>

      <button
        v-if="hiddenCount > 0 || showJunk"
        class="ghost small"
        :title="showJunk ? '隐藏 DJ / 伴奏等魔改版本' : '显示被隐藏的魔改版本'"
        @click="toggleJunk"
      >
        {{ showJunk ? '隐藏魔改版' : `显示魔改版 (${hiddenCount})` }}
      </button>
    </header>

    <!-- 艺人资料 -->
    <div v-if="artist" class="hero">
      <div class="avatar">
        <CoverImage :src="artist.picUrl" :icon-size="46" />
      </div>

      <div class="info">
        <h1 class="ellipsis" :title="artist.name">{{ artist.name }}</h1>
        <div class="meta">
          <span v-for="(part, index) in metaParts" :key="index">{{ part }}</span>
          <span class="tag">{{ platformName }}</span>
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

    <!-- 没选中艺人时（例如直接访问该路由） -->
    <div v-else class="empty">
      <span>还没有选择艺人</span>
      <span class="faint small-text">在搜索页切换到「歌手」模式搜一位吧</span>
      <button class="ghost small" @click="router.push('/search')">去搜索</button>
    </div>

    <div v-if="error" class="notice err">
      <span class="ellipsis">{{ error }}</span>
    </div>

    <!-- 歌曲列表 -->
    <div v-if="artist" class="songs">
      <SongTable
        :songs="songs"
        :loading="loading"
        :current-id="player.current?.id ?? ''"
        empty-text="没有找到这个艺人的歌曲"
        @play="playSong"
        @queue="queueSong"
        @download="downloadSong"
        @search="searchThisArtist"
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

/* ------------------------------ 艺人资料 ------------------------------ */

.hero {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 26px 24px;
  border-bottom: 1px solid var(--line);
}

.avatar {
  flex: none;
  width: 116px;
  height: 116px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  color: var(--text-faint);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
}

.info {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.info h1 {
  font-size: 26px;
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

/* ------------------------------ 歌曲 ------------------------------ */

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

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-faint);
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
