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
import { splitBrackets, STRONG_VARIANT_WORDS } from '@shared/purity'
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
 * 魔改版本过滤。
 *
 * 搜「周杰伦」会涌出大量 DJ 版、伴奏版、串烧 —— 这些不是用户想听的。
 * 做成可关的开关而不是硬过滤：偶尔确实有人想找伴奏，
 * 一刀切掉反而堵死了正当需求。
 *
 * 特征词与搜索页的纯净度排序共用一份（@shared/purity），
 * 但这里只用「强改版词」那一档 —— Live、翻唱、钢琴版属于正常发行，
 * 搜索里降权就够了，不该直接藏起来不给人看。
 */
function isJunk(song: Song): boolean {
  const { brackets, outside } = splitBrackets(song.name)
  const text = `${outside} ${brackets.join(' ')}`.toLowerCase()
  return STRONG_VARIANT_WORDS.some((word) => text.includes(word))
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
    <!-- 页面标题由外壳顶栏渲染；播放/下载/魔改过滤是页面级动作，注入顶栏右侧 -->
    <Teleport to="#page-actions">
      <button class="primary small" :disabled="songs.length === 0" @click="playAll">
        <AppIcon name="play" :size="14" />
        <span>播放全部</span>
      </button>
      <button class="ghost small" :disabled="songs.length === 0" @click="downloadAll">
        <AppIcon name="download" :size="14" />
        <span>下载全部</span>
      </button>
      <button
        v-if="hiddenCount > 0 || showJunk"
        class="ghost small"
        :title="showJunk ? '隐藏 DJ / 伴奏等魔改版本' : '显示被隐藏的魔改版本'"
        @click="toggleJunk"
      >
        {{ showJunk ? '隐藏魔改版' : `显示魔改版 (${hiddenCount})` }}
      </button>
    </Teleport>

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
          <span v-if="songs.length > 0" class="faint">
            {{ songs.length }} 首<template v-if="hiddenCount > 0 && !showJunk">
              · 已滤掉 {{ hiddenCount }} 首魔改</template
            >
          </span>
        </div>

        <div class="actions">
          <button class="ghost small" title="返回上一页" @click="router.back()">
            <AppIcon name="back" :size="14" />
            <span>返回</span>
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

.small-text {
  font-size: var(--fs-xs);
}

/* ------------------------------ 艺人资料 ------------------------------ */

.hero {
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  padding: var(--sp-5) 0;
  border-bottom: 1px solid var(--hairline);
}

/* 圆形头像是全站唯一的 pill/圆形例外（结构需要，不是装饰） */
.avatar {
  flex: none;
  width: 116px;
  height: 116px;
  border-radius: 50%;
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

/* ------------------------------ 歌曲 ------------------------------ */

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

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  color: var(--ink-subtle);
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
