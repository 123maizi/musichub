<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Song } from '@shared/types/music'
import { PLATFORM_META, QUALITY_META, findFormat, qualityRank } from '@shared/constants'
import { useRouter } from 'vue-router'
import { formatTime } from '../utils/format'
import { copyText, songCopyText } from '../utils/clipboard'
import { useDownloadStore } from '../stores/downloads'
import { useLibraryStore } from '../stores/library'
import { usePlayerStore } from '../stores/player'
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
/** 悬停时提前解析取流地址：点下去几乎立刻出声 */
const player = usePlayerStore()

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

/* ------------------------------ 复制歌名 ------------------------------ */

/**
 * 刚复制过的那一行。
 *
 * 复制是「没有视觉结果」的操作 —— 不做反馈，用户根本不知道有没有成功，
 * 会反复点。这里把按钮短暂变成「已复制」，是最轻的确认方式（不弹 toast 打断）。
 */
const copiedId = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copySongName(song: Song): Promise<void> {
  const ok = await copyText(songCopyText(song))
  if (!ok) return
  copiedId.value = song.id
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copiedId.value = ''
    copiedTimer = null
  }, 1400)
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})

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
    <div class="head eyebrow" :class="{ 'no-platform': !showPlatform }">
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

    <div v-else class="body stagger-in">
      <div
        v-for="(song, index) in visibleRows"
        :key="song.id"
        v-memo="rowDeps(song, index)"
        class="row"
        @mouseenter.passive="player.prefetchSong(song)"
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
            :class="{ liked: copiedId === song.id }"
            :title="copiedId === song.id ? '已复制' : '复制歌名（歌手 - 歌名）'"
            @click.stop="copySongName(song)"
          >
            <AppIcon :name="copiedId === song.id ? 'check' : 'copy'" :size="13" />
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
  /*
   * 覆盖层要落在行背景之上、文字之下，就得有个层叠上下文兜底。
   * 关键：这个上下文**只给表容器建一个**，不要给 140 行各建一个 ——
   * 消融实验实测：140 行各自 position+z-index 会让滚动平均帧 7.09 → 8.51ms（每帧 +1.4ms），
   * 因为每行都成了独立绘制容器。合成一个之后回到基线。
   */
  position: relative;
  isolation: isolate;
}

/* 所有行共用同一套栅格，保证列对齐 */
.head,
.row {
  display: grid;
  /*
   * 7 列重排（Lead 批准值，render-perf 按 1199px 容器预演过）：
   *   序号 32 / 标题 1.6fr / 平台 44 / 专辑 1.2fr / 音质 56 / 时长 48 / 操作 200
   * 操作列 200px 是按「歌单页 6 个按钮」算的：6×24(命中区) + 5×4(gap) = 164 ≤ 200。
   * 间隙 8px、表内左右留白走版面契约 --table-pad-x(36px)，两值都落在 4px 网格上。
   */
  grid-template-columns: 32px minmax(160px, 1.6fr) 44px minmax(100px, 1.2fr) 56px 48px 200px;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--table-pad-x);
}

.head.no-platform,
.row.no-platform {
  grid-template-columns: 32px minmax(160px, 1.6fr) minmax(100px, 1.2fr) 56px 48px 200px;
}

/* 已收藏：心形用强调色点亮 */
.liked {
  color: var(--accent);
}

/* 表头：文案样式交给全局 .eyebrow（碑刻衬线 + 疏排 + 大写），这里只管布局与分线 */
.head {
  height: 34px;
  color: var(--ink-subtle);
  border-bottom: 1px solid var(--hairline);
  position: sticky;
  top: 0;
  background: var(--canvas);
  z-index: 2;
}

.body {
  overflow-y: auto;
  min-height: 0;
}

/*
 * 行入场：契约的 .stagger-in 是「前 12 个、34ms 错峰、--dur-2(360ms)」，
 * 总时长 = 34×11 + 360 = 734ms，超过 Lead 定的 700ms 上限。
 * 按指示把错峰压到 24ms（24×11 + 360 = 624ms）。只覆盖延时，动画本身仍用契约的 keyframes。
 */
.stagger-in > *:nth-child(2) {
  animation-delay: 24ms;
}
.stagger-in > *:nth-child(3) {
  animation-delay: 48ms;
}
.stagger-in > *:nth-child(4) {
  animation-delay: 72ms;
}
.stagger-in > *:nth-child(5) {
  animation-delay: 96ms;
}
.stagger-in > *:nth-child(6) {
  animation-delay: 120ms;
}
.stagger-in > *:nth-child(7) {
  animation-delay: 144ms;
}
.stagger-in > *:nth-child(8) {
  animation-delay: 168ms;
}
.stagger-in > *:nth-child(9) {
  animation-delay: 192ms;
}
.stagger-in > *:nth-child(10) {
  animation-delay: 216ms;
}
.stagger-in > *:nth-child(11) {
  animation-delay: 240ms;
}
.stagger-in > *:nth-child(12) {
  animation-delay: 264ms;
}

.row {
  height: 46px;
  border-bottom: 1px solid var(--hairline-soft);
  cursor: default;
  /* 行 hover / 播放 / 选中都不再动 background，改用两层覆盖层只动 opacity。
     这里只做定位包含块（position: relative，不带 z-index），层叠上下文由 .table 统一提供。 */
  position: relative;
  /*
   * 这里试过 content-visibility: auto + contain-intrinsic-size 的视口裁剪，
   * 实测是负收益，已撤掉。数据（同一产物、同一份 140 行数据、滚完 13 屏）：
   *   开：慢滚平均帧 10.8ms / p95 20.3ms
   *   关：慢滚平均帧 6.65ms / p95 8.6ms
   * 原因：行只有 46px、节点也简单，逐行做可见性判定 + 按需布局
   * 比老老实实一次布局完 140 行更贵。
   */
}

/*
 * 行背景反馈：覆盖层 + opacity。
 *
 * 为什么不用 `transition: background`：
 *   - background 是绘制属性，一行 140 个、每个都要重绘整行面积；
 *   - 用 background 简写还会把 box-shadow 一起卷进过渡；
 *   - opacity 走合成层，既不重排也不重绘。
 * 两层分工：::before 管 hover，::after 管「正在播放 / 已选中」。
 * 两者都 z-index:-1 —— 配合 .row 自己的 z-index:0 形成层叠上下文，
 * 覆盖层落在行的背景之上、文字与按钮之下（不会给文字染色）。
 */
.row::before,
.row::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--dur-1) var(--ease-out);
}

.row::before {
  background-color: var(--surface-3);
}

.row:hover::before {
  opacity: 1;
}

/*
 * 播放 / 选中：2px 左刻线 + 极淡底。
 * 两个都用静态绘制写死在覆盖层上，参与过渡的只有 opacity —— 不碰布局。
 * 刻线用行自身的 inset box-shadow（只在状态行上有，不参与任何过渡）：
 * 比给 140 行都挂一条渐变省 —— 实测「每行都带 background-image 渐变」会让
 * 滚动平均帧从 6.8ms 涨到 8.4ms，改成就地 box-shadow 后回到基线。
 */
.row::after {
  background-color: color-mix(in srgb, var(--accent) 7%, transparent);
}

.row.playing::after,
.row.selected::after {
  opacity: 1;
}

.row.playing,
.row.selected {
  box-shadow: inset 2px 0 0 0 var(--accent);
}

/* 播放中 / 已选中的行保持原来的观感：状态色优先于 hover 色 */
.row.playing::before,
.row.selected::before {
  opacity: 0;
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
  left: var(--sp-1);
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
  padding-left: var(--sp-5);
}

.row.selected .title {
  color: var(--accent);
}

/*
 * 行内文字分级：主文字 --ink，次要 --ink-muted，元信息 --ink-subtle。
 * hover / 选中时底色变成 surface-3 / surface-4，而 --ink-subtle 在那两级上只有
 * 4.48 / 4.09（不达 AA），所以元信息在这些状态下抬到 --ink-muted。
 *
 * 注意：这里**不给这几处加 color 过渡** —— 140 行 × 3 个 span = 420 个带过渡的
 * 元素，会让滚动每帧多做一轮样式重算（实测平均帧 +1.5ms）。颜色是瞬时切换，
 * 视觉上察觉不到，代价却是实打实的。
 */
.col-index {
  font-size: var(--fs-xs);
  color: var(--ink-subtle);
}

.col-main {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  line-height: var(--lh-tight);
}

/*
 * 列表里的小封面：缺图时由 CoverImage 退化成图标，不会出现裂图。
 * 圆角走 --r-media —— 全套零圆角体系里唯一的媒体例外（用户明确要求
 * 「缩略图不要太方正、角圆滑一点」）。该 token 未定义时本声明计算为初始值 0px，
 * 与零圆角一致，所以 cover-fix 落 token 之前也不会画错。
 */
.mini-cover {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: var(--r-media);
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  display: grid;
  place-items: center;
  color: var(--ink-subtle);
}

.title-text {
  min-width: 0;
}

.title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--ink);
}

.singer {
  font-size: var(--fs-xs);
  color: var(--ink-muted);
}

/* 歌手 / 专辑名可点：点一下就去搜它 */
.clickable {
  cursor: pointer;
  transition: color var(--dur-1) var(--ease-out);
}

/*
 * hover 时行底已经是 surface-3，--accent 在那上面只有 ~4.3（不达标），
 * 所以用更深的 --accent-hover（与全局 a:hover 同一档）。
 */
.clickable:hover {
  color: var(--accent-hover);
  text-decoration: underline;
}

.col-album {
  font-size: var(--fs-xs);
  color: var(--ink-muted);
}

.col-time {
  font-size: var(--fs-xs);
  color: var(--ink-subtle);
}

/* 行内元信息在 hover / 选中态抬一档，保证浅底上的可读性 */
.row:hover .col-index,
.row:hover .col-time,
.row.playing .col-index,
.row.playing .col-time,
.row.selected .col-index,
.row.selected .col-time {
  color: var(--ink-muted);
}

.col-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-1);
  opacity: 0;
  transition: opacity var(--dur-1) var(--ease-out);
}

.row:hover .col-actions,
.row.playing .col-actions,
.row:focus-within .col-actions {
  opacity: 1;
}

/*
 * 行内小按钮：命中区必须 ≥24px（WCAG 2.5.8）。
 * 图标只有 13px，所以用 min-width/min-height 撑到 24 —— 顺带把 6 个按钮的总宽
 * 压在 164px 以内，200px 的操作列放得下。
 */
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
</style>
