<script setup lang="ts">
/**
 * 正在播放页
 *
 * 大封面 + 滚动歌词。所有图标用内联 SVG（见 AppIcon），
 * 刻意不用 ⏮ ▶ ⏭ 这类符号 —— 它们在 Windows 上会被渲染成彩色 emoji 方块。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { PLATFORM_META, QUALITY_META } from '@shared/constants'
import AppIcon from '../components/AppIcon.vue'
import PlaylistMenu from '../components/PlaylistMenu.vue'
import { useArtistStore } from '../stores/artist'
import { useDownloadStore } from '../stores/downloads'
import { useLibraryStore } from '../stores/library'
import { usePlayerStore } from '../stores/player'
import { bigCoverUrl } from '../utils/cover'
import { cleanIpcError, formatTime } from '../utils/format'
import { downloadCover } from '../utils/ipc'

const router = useRouter()
const player = usePlayerStore()
const library = useLibraryStore()
const downloads = useDownloadStore()
const artistStore = useArtistStore()

const lyricBox = ref<HTMLElement | null>(null)
const toast = ref<string | null>(null)
const seeking = ref(false)
const seekValue = ref(0)

/**
 * 轨道像素宽度（不带单位的数字，契约里只有圆点需要）。
 * 圆点以前写 `left: ${progress}%` —— 布局属性，每次进度更新都要重排；
 * 现在改由 `translate3d(calc(--p × --track-w × 1px / 100), …)` 走合成层。
 */
const railEl = ref<HTMLElement | null>(null)
const railWidth = ref(0)
let railObserver: ResizeObserver | null = null

/**
 * 进度「跳」而不是「走」的当帧关掉过渡（容器挂 .no-motion）：
 * 换歌归零、单曲循环归零、往回拖、换源落位夹到新流末尾。
 * 判据只有「这一帧的值比上一帧小」，下一次前进/相等的值到来时自动恢复。
 */
const noMotion = ref(false)
watch(
  () => player.progress,
  (next, prev) => {
    noMotion.value = next + 0.01 < prev
  }
)

onMounted(() => {
  const el = railEl.value
  if (!el) return
  railWidth.value = el.clientWidth
  railObserver = new ResizeObserver(() => {
    railWidth.value = el.clientWidth
  })
  railObserver.observe(el)
})

onBeforeUnmount(() => {
  railObserver?.disconnect()
  railObserver = null
})

/** 播放模式 → 图标名 */
const MODE_ICON = {
  order: 'list',
  loop: 'loop',
  single: 'single',
  shuffle: 'shuffle'
} as const

const platformName = computed(() =>
  player.current ? (PLATFORM_META[player.current.platform]?.name ?? player.current.platform) : ''
)

const qualityLabel = computed(() => {
  const q = player.urlInfo?.quality ?? player.quality
  return QUALITY_META[q]?.short ?? String(q)
})

const isFavorite = computed(() =>
  player.current ? library.isFavorite(player.current.id) : false
)

const hasLyric = computed(() => player.lyricLines.length > 0)

const lyricHint = computed(() => {
  if (hasLyric.value) return ''
  if (player.loading) return '正在获取歌词…'
  if (!player.current) return '还没有开始播放'
  return '这首歌暂时没有歌词'
})

/* ------------------------------ 歌词翻译 ------------------------------ */

const translateLabel = computed(() => {
  if (player.translating) return '翻译中…'
  if (player.translated) return player.showTranslation ? '隐藏译文' : '显示译文'
  return '翻译歌词'
})

const translateTitle = computed(() =>
  player.translated ? '点击切换译文显示' : '把外语歌词翻成中文'
)

/**
 * 译文来源标签。
 * 用 AI 翻的时候直接报出模型名 —— 用户想知道自己配的那个模型到底有没有在工作。
 */
const providerLabel = computed(() => {
  if (player.savedEdited) return '已手工修改'
  const src = player.savedProvider
  if (src === 'manual') return '本歌词由你自己填写'
  if (src === 'official') return '本歌词来自平台官方翻译'
  if (src === 'public') return '本歌词由内置翻译提供'
  const model = player.savedProviderName
  return model ? `本歌词由 ${model} 翻译` : '本歌词由 AI 翻译'
})

/** 已经翻过就不重复请求（翻译接口有配额），只切换显示 */
async function onTranslate(): Promise<void> {
  const ok = await player.translateCurrentLyric()
  if (!ok && player.translateError) toast.value = player.translateError
}

async function onSaveEditor(): Promise<void> {
  const ok = await player.saveEditor()
  toast.value = ok ? '译文已保存，之后切歌回来都还在' : player.translateError || '保存失败'
}

async function onClearTranslation(): Promise<void> {
  await player.clearTranslation()
  toast.value = '已清除译文，可以重新翻译'
}

/* ------------------------------ 歌手 / 专辑跳转 ------------------------------ */

/** 大图要 500px 的，列表里用 120px 的省流量 */
const bigCover = computed(() => bigCoverUrl(player.current?.picUrl))

const openingArtist = ref(false)

/**
 * 拆出可能的歌手名候选。
 *
 * 一首歌的歌手字段常常挤着好几位：酷我用 `&` 拼，QQ 用 `/` 拼，各平台
 * 还用 `、`。但这里刻意「先整串、再逐段」—— 因为有些艺人名字本身就带
 * 分隔符（Tyler, The Creator 带逗号，AC/DC 带斜杠），一上来就拆会把人拆坏。
 * 整串能精确命中就不拆，命中不了才退而求其次。
 */
function artistCandidates(raw: string): string[] {
  const out: string[] = []
  const push = (value: string): void => {
    const name = value.trim()
    if (name && !out.includes(name)) out.push(name)
  }
  push(raw)
  raw.split(/[&、/]/).forEach(push)
  return out.slice(0, 3)
}

const artistTitle = computed(() => {
  const singer = player.current?.singer
  return singer ? `查看「${singer}」的艺人页` : ''
})

async function openArtistPage(): Promise<void> {
  const song = player.current
  if (!song || openingArtist.value) return

  const raw = (song.singer ?? '').trim()
  if (!raw) return

  openingArtist.value = true
  try {
    const names = artistCandidates(raw)
    let picked = null as (typeof artistStore.allArtists)[number] | null

    // 只认「名字完全一致」的结果 —— 多歌手拼成的名字拿去搜，
    // 首条结果十有八九是别人，直接取会开错主页。
    // 比较时忽略大小写与空白：搜索接口返回的大小写未必和歌曲信息一致
    const same = (a: string, b: string): boolean =>
      a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase()

    for (const name of names) {
      await artistStore.search(name)
      const exact = artistStore.allArtists.find((a) => same(a.name, name))
      if (exact) {
        picked = exact
        break
      }
    }

    if (!picked) {
      // 没有完全一致的，退回第一段（通常是主唱）并如实说明是「最接近的」
      const fallbackName = names[1] ?? raw
      await artistStore.search(fallbackName)
      picked = artistStore.allArtists[0] ?? null
      if (picked) toast.value = `没找到完全一致的艺人，先打开最接近的「${picked.name}」`
    }

    if (!picked) {
      toast.value = `没搜到艺人「${names[0] ?? raw}」`
      return
    }

    artistStore.select(picked)
    void router.push('/artist')
  } catch (err) {
    toast.value = cleanIpcError(err)
  } finally {
    openingArtist.value = false
  }
}

/** 点专辑名 → 专辑页（专辑页直接从 query 读，不需要先请求） */
function openAlbumPage(): void {
  const song = player.current
  const name = (song?.albumName ?? '').trim()
  if (!song || !name) return
  void router.push({
    path: '/album',
    query: { name, singer: song.singer, platform: song.platform }
  })
}

/* ------------------------------ 进度条 ------------------------------ */

const displayProgress = computed(() =>
  seeking.value ? seekValue.value : player.progress
)

/**
 * 原生 range 的 value 只在「需要当基准」时才同步，且必须绑字符串 +
 * 与 step 对齐的精度（range 会按 step 把 value 对齐，绑未对齐的数字会导致
 * 每次重渲染都写一次 value，从而重排输入框内部影子树：实测 1.02 次布局/更新）。
 * 拖动时不能写它，否则会把用户拖到一半的值打回去。
 */
const seekBase = ref(0)
let lastSeekSync = 0
watch(
  () => player.progress,
  (next, prev) => {
    const jumpedBack = next + 0.5 < (prev ?? 0)
    const now = Date.now()
    if (!jumpedBack && player.playing && now - lastSeekSync < 1000) return
    lastSeekSync = now
    seekBase.value = next
  },
  { immediate: true }
)

/** 实际绑给 range 的值：拖动中跟随手指，平时用低频基准（精度与 step 对齐） */
const seekInputProp = computed(() =>
  String(Math.round((seeking.value ? seekValue.value : seekBase.value) * 10) / 10)
)

const displayTime = computed(() =>
  seeking.value && player.duration > 0
    ? (seekValue.value / 100) * player.duration
    : player.currentTime
)

function onSeekInput(event: Event): void {
  seeking.value = true
  seekValue.value = Number((event.target as HTMLInputElement).value)
}

function onSeekCommit(event: Event): void {
  player.seekByPercent(Number((event.target as HTMLInputElement).value))
  seeking.value = false
}

/* ------------------------------ 歌词滚动 ------------------------------ */

watch(
  () => player.currentLyricIndex,
  async (index) => {
    const box = lyricBox.value
    if (index < 0 || !box) return
    await nextTick()
    const line = box.querySelector<HTMLElement>(`[data-line="${index}"]`)
    if (!line) return
    // 用容器自身滚动，避免把整个页面顶跑
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: 'smooth'
    })
  }
)

/* ------------------------------ 操作 ------------------------------ */

function notify(message: string): void {
  toast.value = message
  setTimeout(() => {
    if (toast.value === message) toast.value = null
  }, 2200)
}

async function toggleFavorite(): Promise<void> {
  const song = player.current
  if (!song) return
  await library.toggleFavorite(song)
  notify(isFavorite.value ? '已收藏' : '已取消收藏')
}

async function downloadCurrent(): Promise<void> {
  const song = player.current
  if (!song) return
  await downloads.add([song], { quality: player.quality })
  notify('已加入下载队列')
}

function queueCurrent(): void {
  const song = player.current
  if (song) {
    player.addToQueue(song)
    notify('已加入播放队列')
  }
}

/* ------------------------------ 加入歌单 ------------------------------ */

const menuOpen = ref(false)
const menuAnchor = ref<HTMLElement | null>(null)

function openPlaylistMenu(event: MouseEvent): void {
  if (!player.current) return
  menuAnchor.value = event.currentTarget as HTMLElement
  menuOpen.value = true
}

function onAddedToPlaylist(playlist: string, count: number): void {
  notify(`已加入《${playlist}》${count > 1 ? ` ${count} 首` : ''}`)
}

/* ------------------------------ 下载封面 ------------------------------ */

const savingCover = ref(false)

/**
 * 把当前歌曲的封面存到本地。
 *
 * 平台没给封面时由主进程跨平台补一张，所以「没有封面」的歌也能存下来。
 * 存的是原图尺寸（酷我能要到 1000px），不是列表里那张缩略图。
 */
async function saveCover(): Promise<void> {
  const song = player.current
  if (!song || savingCover.value) return

  savingCover.value = true
  try {
    const result = await downloadCover(song)
    notify(`封面已保存（${Math.round(result.bytes / 1024)} KB）：${result.path.split('\\').pop()}`)
  } catch (err) {
    notify(cleanIpcError(err))
  } finally {
    savingCover.value = false
  }
}
</script>

<template>
  <section class="view">
    <!--
      页面级操作注入外壳顶栏右侧（App.vue 的 #page-actions）。
      标题由外壳读 route.meta.title 渲染，视图自己不再画 header ——
      否则会出现「顶栏标题 + 视图标题」两份。
    -->
    <Teleport to="#page-actions">
      <button class="icon-btn" title="返回" @click="router.back()">
        <AppIcon name="back" :size="16" />
      </button>
      <span
        v-if="player.urlInfo"
        class="tag accent"
        :title="`由音源「${player.urlInfo.sourceName}」提供`"
      >
        {{ qualityLabel }}
      </span>
      <span v-if="player.urlInfo" class="faint src-name ellipsis">
        {{ player.urlInfo.sourceName }}
      </span>
    </Teleport>

    <div class="stage">
      <!-- 左：封面与控制 -->
      <div class="left">
        <div class="cover">
          <!--
            交叉淡入：以歌曲 id 为 key，换歌时新旧两层同帧交叉（不加 mode）。
            包一层 .cover-layer 是因为 CoverImage 是 v-if/v-else 的双根片段组件，
            而 <Transition> 要求单一元素子节点。
          -->
          <Transition name="xfade">
            <div class="cover-layer" :key="player.current?.id ?? 'none'">
              <CoverImage
                :src="bigCover"
                :song="player.current ?? undefined"
                :icon-size="56"
                prefer-resolved
                fallback
              />
            </div>
          </Transition>
        </div>

        <div class="meta">
          <h1 class="ellipsis" :title="player.current?.name">
            {{ player.current?.name ?? '未在播放' }}
          </h1>
          <div class="sub">
            <button
              class="jump"
              :disabled="!player.current || openingArtist"
              :title="artistTitle"
              @click="openArtistPage"
            >
              <span class="ellipsis">{{ player.current?.singer ?? '—' }}</span>
            </button>
            <span v-if="player.current" class="faint"> · {{ platformName }}</span>
          </div>
          <button
            v-if="player.current?.albumName"
            class="jump album faint"
            :title="`查看专辑「${player.current.albumName}」`"
            @click="openAlbumPage"
          >
            <span class="ellipsis">{{ player.current.albumName }}</span>
          </button>
        </div>

        <div class="tools">
          <button class="tool" :class="{ on: isFavorite }" :disabled="!player.current" @click="toggleFavorite">
            <AppIcon :name="isFavorite ? 'heart-filled' : 'heart'" :size="15" :filled="isFavorite" />
            <span>{{ isFavorite ? '已收藏' : '收藏' }}</span>
          </button>
          <button class="tool" :disabled="!player.current" @click="downloadCurrent">
            <AppIcon name="download" :size="15" />
            <span>下载</span>
          </button>
          <button class="tool" :disabled="!player.current" @click="queueCurrent">
            <AppIcon name="plus" :size="15" />
            <span>队列</span>
          </button>
          <button class="tool" :disabled="!player.current" title="把这首歌加入歌单" @click="openPlaylistMenu">
            <AppIcon name="playlist" :size="15" />
            <span>歌单</span>
          </button>
          <button
            class="tool"
            :disabled="!player.current || savingCover"
            title="把这首歌的封面图片存到下载目录"
            @click="saveCover"
          >
            <AppIcon name="disc" :size="15" />
            <span>{{ savingCover ? '保存中…' : '存封面' }}</span>
          </button>
        </div>

        <!-- 进度：与底部播放条共用一套写法（--p 变量 + transform，不再用 width/left 驱动） -->
        <div class="progress-row">
          <span class="time mono">{{ formatTime(displayTime) }}</span>
          <div class="seek-wrap" :class="{ seeking, 'no-motion': noMotion }">
            <div
              class="seek-rail"
              ref="railEl"
              :style="{ '--p': displayProgress, '--track-w': railWidth }"
            >
              <div class="seek-fill"></div>
              <div class="seek-knob"></div>
            </div>
            <input
              class="seek"
              type="range"
              min="0"
              max="100"
              step="0.1"
              :value="seekInputProp"
              :disabled="!player.current || player.duration <= 0"
              aria-label="播放进度"
              @input="onSeekInput"
              @change="onSeekCommit"
            />
          </div>
          <span class="time mono faint">{{ formatTime(player.duration) }}</span>
        </div>

        <!-- 传输控制 -->
        <div class="controls">
          <button class="ctrl" title="上一首" :disabled="player.playlist.length === 0" @click="player.playPrev()">
            <AppIcon name="prev" :size="22" />
          </button>
          <button
            class="ctrl main"
            :title="player.playing ? '暂停' : '播放'"
            :disabled="!player.current || player.loading"
            @click="player.toggle()"
          >
            <AppIcon :name="player.playing ? 'pause' : 'play'" :size="24" />
          </button>
          <button class="ctrl" title="下一首" :disabled="player.playlist.length === 0" @click="player.playNext()">
            <AppIcon name="next" :size="22" />
          </button>
          <button class="mode-btn" :title="player.modeLabel" @click="player.cycleMode()">
            <AppIcon :name="MODE_ICON[player.mode]" :size="15" />
            <span>{{ player.modeLabel }}</span>
          </button>
        </div>
      </div>

      <!-- 右：歌词 -->
      <div class="right">
        <div v-if="hasLyric" class="lyric-bar">
          <button
            class="translate-btn"
            :class="{ on: player.translated && player.showTranslation }"
            :disabled="player.translating"
            :title="translateTitle"
            @click="onTranslate"
          >
            <AppIcon name="translate" :size="14" />
            <span>{{ translateLabel }}</span>
          </button>

          <!-- 译文不准时自己改：同一个入口既管「修改」也管「添加」 -->
          <button
            class="translate-btn"
            :title="player.translated ? '逐行修改译文' : '手工添加译文'"
            @click="player.openEditor()"
          >
            <AppIcon name="edit" :size="13" />
            <span>{{ player.translated ? '修改译文' : '添加译文' }}</span>
          </button>

          <button
            v-if="player.translated"
            class="translate-btn"
            title="删掉译文，下次点翻译会重新翻一遍"
            @click="onClearTranslation"
          >
            <AppIcon name="close" :size="12" />
            <span>清除</span>
          </button>

          <span v-if="player.savedEdited" class="translate-note">已手工修改</span>
          <span v-else-if="providerLabel" class="translate-note">{{ providerLabel }}</span>
          <span v-if="player.translateError" class="translate-note ellipsis">
            {{ player.translateError }}
          </span>
        </div>

        <!-- 译文编辑器：改准了再存，存了就一直在 -->
        <div v-if="player.editing" class="editor">
          <div class="editor-head">
            <span class="editor-title">逐行编辑译文</span>
            <span class="faint small-text">留空表示这行不翻；保存后会一直保留</span>
          </div>
          <div class="editor-body">
            <div v-for="(line, index) in player.editLines" :key="index" class="editor-row">
              <div class="editor-src ellipsis">{{ line.text }}</div>
              <input
                v-model="line.trans"
                class="editor-input"
                :placeholder="`第 ${index + 1} 行的译文`"
              />
            </div>
          </div>
          <div class="editor-foot">
            <button class="primary small" :disabled="player.savingEdit" @click="onSaveEditor">
              {{ player.savingEdit ? '保存中…' : '保存译文' }}
            </button>
            <button class="ghost small" @click="player.closeEditor()">取消</button>
          </div>
        </div>

        <div v-if="!hasLyric" class="lyric-empty">
          <AppIcon name="music" :size="26" />
          <span>{{ lyricHint }}</span>
        </div>

        <div v-else ref="lyricBox" class="lyric-box">
          <div class="lyric-pad"></div>
          <div
            v-for="(line, index) in player.lyricLines"
            :key="index"
            class="lyric-line"
            :class="{ 'is-active': index === player.currentLyricIndex }"
            :data-line="index"
            @click="player.seek(line.time)"
          >
            <span class="lyric-main">{{ line.text || '·' }}</span>
            <span v-if="player.showTranslation && line.trans" class="lyric-trans">
              {{ line.trans }}
            </span>
          </div>
          <div class="lyric-pad"></div>
        </div>
      </div>
    </div>

    <div v-if="player.error" class="error-strip">
      <span class="ellipsis">{{ player.error }}</span>
      <button class="ghost small" @click="player.error = null">知道了</button>
    </div>

    <!-- 居中 toast：用 motion.css 的 toast-center（自带 translateX(-50%) 的居中补偿） -->
    <Transition name="toast-center">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>

    <!-- 加入歌单：面板自己挂到 body 上，位置跟着刚点的那个按钮 -->
    <PlaylistMenu
      v-if="menuOpen && player.current"
      :songs="[player.current]"
      :anchor="menuAnchor"
      @close="menuOpen = false"
      @added="onAddedToPlaylist"
    />
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

/* ------------------------------ 顶栏 ------------------------------ */

/* 顶栏已交给外壳（#page-actions 注入），这里只保留被注入控件的样式 */

.icon-btn {
  width: var(--sp-6);
  height: var(--sp-6);
  padding: 0;
  display: grid;
  place-items: center;
  border-radius: var(--r-ctl);
  background: transparent;
  border: 1px solid var(--hairline);
  color: var(--ink-muted);
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.icon-btn:hover {
  background: var(--surface-3);
  color: var(--ink);
}

.src-name {
  max-width: 150px;
  font-size: var(--fs-xs);
  color: var(--ink-subtle);
}

.small {
  font-size: var(--fs-xs);
}

/* ------------------------------ 布局 ------------------------------ */

/**
 * 左右留白由外壳的 .page（--page-pad-x 40px）负责 —— 这里再加就会叠成 80px。
 * 所以只负责纵向节奏与大留白（大留白本身就是零阴影体系里的「托底」）。
 */
.stage {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(300px, 400px) 1fr;
  gap: var(--sp-7);
  padding: var(--sp-6) 0 var(--sp-7);
  overflow: hidden;
}

.left {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
  min-height: 0;
  overflow-y: auto;
}

/* ------------------------------ 封面 ------------------------------ */

/**
 * 「雕塑感」不靠阴影，靠**双刻线 + 衬底留白**：
 * 外层 1px 刻线是画框，内层（.cover-layer）再一圈刻线，两层之间露出 canvas 当卡纸。
 * 零圆角、零阴影，块面清楚；换歌时的交叉淡入发生在这两层之间。
 */
.cover {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--r-card);
  background: var(--canvas);
  border: var(--column-rule) solid var(--hairline);
  padding: var(--sp-3);
  display: grid;
  place-items: center;
  color: var(--ink-faint);
  flex: none;
  box-shadow: var(--shadow-2);
}

/**
 * 封面层。
 *
 * 换歌时用 <Transition name="xfade"> 让新旧两层同时存在（不加 mode），
 * 旧层在 leave 期间仍然持有它自己那张 <img>，这才是真正的交叉淡入；
 * 若只换 src 不换层，旧图会瞬间消失，看起来就是「硬闪一下」。
 * 绝对定位是常驻的静态样式（不是动画属性），所以不产生任何布局动画。
 */
.cover-layer {
  position: absolute;
  inset: var(--sp-3);
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--hairline-soft);
  background: var(--surface-2);
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* ------------------------------ 曲目信息 ------------------------------ */

.meta {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

/* 标题走外壳的衬线体系（style.css 的 h1~h4），这里只收一档字号 */
.meta h1 {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
  color: var(--ink);
}

.sub {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  min-width: 0;
  font-size: var(--fs-sm);
  color: var(--ink-muted);
}

.album {
  font-size: var(--fs-xs);
}

/* 可点的歌手 / 专辑：长得像文字，点上去才亮出来 —— 免得满屏都是按钮 */
.jump {
  display: block;
  min-width: 0;
  max-width: 100%;
  padding: var(--sp-1) var(--sp-2);
  margin-left: calc(var(--sp-2) * -1);
  text-align: left;
  font: inherit;
  color: inherit;
  background: transparent;
  border: none;
  border-radius: var(--r-ctl);
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.sub .jump {
  color: var(--text);
}

.jump:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--accent);
}

.jump:disabled {
  cursor: default;
  opacity: 0.7;
}

/* ------------------------------ 工具胶囊 ------------------------------ */

.tools {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
}

.tool {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  font-size: var(--fs-xs);
  border-radius: var(--r-ctl);
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  color: var(--ink-muted);
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}

.tool:hover:not(:disabled) {
  background: var(--surface-3);
  color: var(--ink);
}

/* 选中态用青铜描边 + 淡底；它落在 surface-2 上，文字用 --ink 保证达标 */
.tool.on {
  color: var(--ink);
  border-color: var(--accent-ring);
  background: var(--accent-soft);
}

/* ------------------------------ 进度 ------------------------------ */

.progress-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.time {
  font-size: var(--fs-xs);
  color: var(--ink-muted);
  min-width: var(--sp-7);
  text-align: center;
}

/* 命中区 24px：可见轨道 2px，但滑块与原生 range 都能轻松命中（WCAG 2.5.8） */
.seek-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  height: var(--sp-5);
  display: flex;
  align-items: center;
}

.seek-rail {
  position: relative;
  width: 100%;
  height: 2px;
  background: var(--hairline);
  /* 契约已把轨道宽度改名为 --track-w（--rail-w 是导航柱宽度），这里给本地默认值兜底 */
  --track-w: 0;
  /**
   * 已评估例外（见 styles/motion.css 第 1 条）：保留 height 过渡。
   * 只有 2px→4px、只在悬停时发生、频率极低；scaleY 会把两端拉变形。
   */
  transition: height var(--dur-1) var(--ease-out);
}

/**
 * 已播放段：常驻满宽，进度只由 `--p`（0~100）经 transform 缩放决定。
 * 之前是内联 `width: ${progress}%` —— 布局属性，每次进度更新都要重排一遍。
 */
.seek-fill {
  position: absolute;
  inset: 0;
  background: var(--progress);
  transform-origin: left center;
  transform: scaleX(calc(var(--p, 100) / 100));
  transition: transform var(--dur-3) var(--ease-out);
}

/* 方头滑块：与播放条同一套（8×12 硬边青铜方块 + 同底色描边） */
.seek-knob {
  --knob-size: 8px;
  position: absolute;
  top: 50%;
  left: 0;
  width: var(--knob-size);
  height: 12px;
  margin-left: calc(var(--knob-size) / -2);
  border-radius: var(--r-card);
  background: var(--progress);
  border: 2px solid var(--canvas);
  /* 契约规定 --track-w 是不带单位的数字，所以要补 `* 1px` 才能得到长度 */
  transform: translate3d(calc(var(--p, 0) * var(--track-w, 0) * 1px / 100), -50%, 0)
    scale(var(--knob-scale, 0.9));
  transition: transform var(--dur-3) var(--ease-out);
  pointer-events: none;
}

.seek-wrap:hover .seek-knob,
.seek-wrap.seeking .seek-knob {
  --knob-scale: 1.15;
}

.seek-wrap:hover .seek-rail,
.seek-wrap.seeking .seek-rail {
  height: 4px;
  /* 悬停反馈走轨道色阶；原来这里给填充换的是硬编码蓝 #5b9bff，已删除 */
  background: var(--hairline-strong);
}

/* 交互层：透明覆盖 24px 命中区，键盘与拖动都靠它 */
.seek {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: var(--sp-5);
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
  opacity: 0;
}

.seek::-webkit-slider-runnable-track {
  height: var(--sp-5);
  background: transparent;
}

.seek::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: var(--sp-5);
  height: var(--sp-5);
  border-radius: var(--r-card);
  background: transparent;
}

.seek:disabled {
  cursor: default;
}

/* ------------------------------ 控制按钮 ------------------------------ */

.controls {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  margin-top: var(--sp-1);
}

.ctrl {
  width: 46px;
  height: 46px;
  padding: 0;
  border-radius: var(--r-ctl);
  background: transparent;
  border: none;
  color: var(--ink-muted);
  display: grid;
  place-items: center;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out),
    transform var(--dur-1) var(--ease-out);
}

.ctrl:hover:not(:disabled) {
  background: var(--surface-3);
  color: var(--ink);
}

.ctrl:active:not(:disabled) {
  transform: scale(0.95);
}

/* 主按钮：青铜实心，零圆角零阴影（层次靠块面，不靠浮起） */
.ctrl.main {
  width: 60px;
  height: 60px;
  border-radius: var(--r-ctl);
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: var(--shadow-2);
}

.ctrl.main:hover:not(:disabled) {
  background: var(--accent-hover);
  color: var(--on-accent);
}

.ctrl:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  margin-left: auto;
  padding: var(--sp-1) var(--sp-3);
  font-size: var(--fs-xs);
  border-radius: var(--r-ctl);
  background: transparent;
  border: 1px solid var(--hairline);
  color: var(--ink-muted);
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.mode-btn:hover {
  background: var(--surface-3);
  color: var(--ink);
}

/* ------------------------------ 歌词 ------------------------------ */

.right {
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.lyric-box {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  /* #000 是遮罩的透明度停止点，不是主题色 —— 与配色体系无关 */
  mask-image: linear-gradient(180deg, transparent, #000 14%, #000 86%, transparent);
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 14%, #000 86%, transparent);
}

.lyric-box::-webkit-scrollbar {
  display: none;
}

.lyric-pad {
  height: 42%;
}

/**
 * 歌词行。
 *
 * 行高、字号、常态色、以及「当前行」的过渡都由 styles/motion.css 的全局
 * `.lyric-line` / `.lyric-line.is-active` 负责（那边只用 transform + 颜色）。
 * 这里只留本页特有的布局与悬停：
 *  · 显式 display:block —— 全局规则是 flex 单行布局，而本页每行含
 *    「原文 + 译文」两段，必须保持块级堆叠；
 *  · 绝不在 .is-active 里改 font-size / font-weight：那会改变这一行以及
 *    它后面所有行的高度，歌词滚动用的 offsetTop 一变就会跳行
 *    （强调改由 motion.css 的 scale + 颜色完成，transform 不影响布局盒）。
 */
.lyric-line {
  display: block;
  padding: var(--sp-2) var(--sp-3);
  line-height: var(--lh-base);
  cursor: pointer;
  border-radius: var(--r-ctl);
}

.lyric-line:hover {
  background: var(--surface-3);
}

/* ------------------------------ 歌词翻译 ------------------------------ */

.lyric-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: 0 var(--sp-3) var(--sp-2);
  flex: none;
}

.translate-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 12.5px;
  border-radius: var(--r-ctl);
  background: transparent;
  border: 1px solid var(--hairline);
  color: var(--ink-muted);
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}

.translate-btn:hover:not(:disabled) {
  background: var(--surface-3);
  color: var(--ink);
}

.translate-btn.on {
  color: var(--ink);
  border-color: var(--accent-ring);
  background: var(--accent-soft);
}

.translate-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.translate-note {
  font-size: var(--fs-xs);
  color: var(--ink-subtle);
  min-width: 0;
}

/* 译文：比原文小一档、浅一档，读到主句时译文不抢戏 */
.lyric-main {
  display: block;
}

/* ------------------------------ 译文编辑器 ------------------------------ */

.editor {
  flex: none;
  margin: 0 var(--sp-3) var(--sp-3);
  border: 1px solid var(--hairline);
  border-radius: var(--r-card);
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
  max-height: 46vh;
}

.editor-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-3);
  border-bottom: 1px solid var(--hairline);
}

.editor-title {
  font-size: var(--fs-sm);
  color: var(--ink);
}

.editor-body {
  overflow-y: auto;
  padding: var(--sp-2) var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.editor-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
  align-items: center;
}

.editor-src {
  font-size: var(--fs-sm);
  color: var(--ink-muted);
  min-width: 0;
}

.editor-input {
  width: 100%;
  font-size: var(--fs-sm);
  padding: var(--sp-1) var(--sp-2);
}

.editor-foot {
  display: flex;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border-top: 1px solid var(--hairline);
}

.lyric-trans {
  display: block;
  margin-top: var(--sp-1);
  font-size: var(--fs-xs);
  font-weight: var(--fw-normal);
  line-height: var(--lh-base);
  color: var(--ink-faint);
}

.lyric-line.is-active .lyric-trans {
  color: var(--ink-muted);
}

.lyric-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-4);
  height: 100%;
  color: var(--ink-subtle);
  font-size: var(--fs-sm);
}

/* ------------------------------ 其它 ------------------------------ */

.error-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-5);
  background: var(--danger-soft);
  border-top: 1px solid var(--danger-line);
  font-size: var(--fs-xs);
  color: var(--danger-text);
}

/* 居中 toast：用 motion.css 的 toast-center（它自带 translateX(-50%)） */
.toast {
  position: absolute;
  bottom: var(--sp-5);
  left: 50%;
  padding: var(--sp-2) var(--sp-4);
  border-radius: var(--r-ctl);
  background: var(--surface-1);
  border: 1px solid var(--hairline);
  font-size: var(--fs-sm);
  color: var(--ink);
  box-shadow: var(--shadow-2);
}
</style>
