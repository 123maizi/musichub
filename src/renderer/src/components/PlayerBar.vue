<script setup lang="ts">
/**
 * 底部播放条
 * 图标全部走 AppIcon（内联 SVG），不再使用 ⏮ ▶ ⏭ 这类符号。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PLATFORM_META, QUALITY_META } from '@shared/constants'
import AppIcon from './AppIcon.vue'
import PlaylistMenu from './PlaylistMenu.vue'
import { useDownloadStore } from '../stores/downloads'
import { useLibraryStore } from '../stores/library'
import { usePlayerStore } from '../stores/player'
import { formatTime } from '../utils/format'

const player = usePlayerStore()
const downloads = useDownloadStore()
const library = useLibraryStore()

/** 播放模式 → 图标名 */
const MODE_ICON = {
  order: 'list',
  loop: 'loop',
  single: 'single',
  shuffle: 'shuffle'
} as const

const seeking = ref(false)
const seekValue = ref(0)

/**
 * 轨道像素宽度（**不带单位的数字**，契约里只有圆点需要它）。
 *
 * 圆点以前写的是 `left: ${progress}%` —— left 是布局属性，每次进度更新
 * （timeupdate 每秒 4 次，拖动时更高频）都会让样式重算 + 重新布局。
 * 实测：200 次进度更新 → LayoutCount +212 / RecalcStyleCount +212（1.06 次/更新）。
 * 现在改成 `translate3d(calc(--p × --track-w × 1px / 100), …)`，走合成层，不再触发布局。
 */
const railEl = ref<HTMLElement | null>(null)
const railWidth = ref(0)
let railObserver: ResizeObserver | null = null

/**
 * 进度「跳」而不是「走」的那些瞬间：换歌归零、单曲循环归零、用户往回拖、
 * 换源落位被夹到新流末尾。这几帧必须关掉过渡（容器挂 .no-motion），
 * 否则填充会从 100% 倒着缩回去 —— 那正是上一轮刚修掉的「进度回退」观感。
 *
 * 判据只用「这一帧的值比上一帧小」：下一次前进/相等的值到来时自动恢复过渡，
 * 不需要定时器，也不会在正常播放（值单调递增）时误触发。
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
  // 窗口缩放 / 侧栏折叠都会改轨道宽度，圆点必须跟着重新算
  railObserver = new ResizeObserver(() => {
    railWidth.value = el.clientWidth
  })
  railObserver.observe(el)
})

onBeforeUnmount(() => {
  railObserver?.disconnect()
  railObserver = null
})

const platformName = computed(() =>
  player.current ? (PLATFORM_META[player.current.platform]?.name ?? player.current.platform) : ''
)

const qualityLabel = computed(() => {
  const q = player.urlInfo?.quality ?? player.quality
  return QUALITY_META[q]?.short ?? String(q)
})

const isCurrentFavorite = computed(() =>
  player.current ? library.isFavorite(player.current.id) : false
)

/**
 * 原生 range：**不再用 `:value` 绑定**，改由 DOM 自己持有值，只在明确时机同步。
 *
 * 为什么要这样：绑 `:value` 时每次渲染都要比较并可能写 value，而写 range 的
 * value 会让浏览器重排输入框内部影子树（实测 1.02 次布局/更新）。
 * 刻度也改成**秒**（min=0, max=时长, step=5）：这样键盘一次 ←/→ 正好 5 秒，
 * 与 store 的位置一一对应，不必在百分比与秒之间来回换算。
 */
const seekInputEl = ref<HTMLInputElement | null>(null)
const seekMax = computed(() => Math.max(0, Math.floor(player.duration || 0)))

/** 同步 DOM 值到真实进度。只在「用户即将用它」的时刻调用，平时一次都不写。 */
function syncSeekInput(): void {
  const el = seekInputEl.value
  if (!el) return
  const seconds = seeking.value
    ? (seekValue.value / 100) * (player.duration || 0)
    : player.currentTime
  const next = String(Math.round(seconds))
  if (el.value !== next) el.value = next
}

/**
 * 键盘改值前先把基准对齐到真实进度。
 * keydown 早于浏览器对 range 的默认步进，所以这里同步完，紧接着的
 * ←/→ 就是「从当前真实位置再走 5 秒」，绝不会从 1 秒前的旧值起步。
 *
 * ⚠️ 别改成「拦截 ←/→ 手动 ±5 秒 + 把 step 调细」—— 我在 NowPlayingView 上试过，
 * 会让点击与拖动一起坏掉（误差 −12/−76.6/−141px、回弹 146，且在可信环境下复现）。
 */
function onSeekKeydown(event: KeyboardEvent): void {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']
  if (keys.includes(event.key)) syncSeekInput()
}

/** 换歌 / 播放状态变化时把基准跟上（这两个时机频率极低） */
watch(() => player.current?.id, syncSeekInput)
watch(() => player.playing, syncSeekInput)

onMounted(() => {
  syncSeekInput()
  const el = railEl.value
  if (!el) return
  railWidth.value = el.clientWidth
  // 窗口缩放 / 侧栏折叠都会改轨道宽度，圆点必须跟着重新算
  railObserver = new ResizeObserver(() => {
    railWidth.value = el.clientWidth
  })
  railObserver.observe(el)
})

/**
 * 位置来源唯一化：提交后把**目标百分比**钉住，直到 store 的 progress 追上
 * （阈值 1%，600ms 兜底）。否则 `seeking=false` 的那一刻填充会先弹回旧位置、
 * 等 store 追上再跳 —— 用户看到的就是「进度条在鼠标前面/后面」。
 */
const pendingSeek = ref<number | null>(null)
let pendingTimer: ReturnType<typeof setTimeout> | null = null

function holdSeekTarget(percent: number): void {
  pendingSeek.value = percent
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    pendingSeek.value = null
    pendingTimer = null
  }, 600)
}

/** 拖动时用本地值预览；提交后用钉住的目标；其余时间跟 store */
const displayProgress = computed(() => {
  if (seeking.value) return seekValue.value
  if (pendingSeek.value !== null) return pendingSeek.value
  return player.progress
})

watch(
  () => player.progress,
  (p) => {
    if (pendingSeek.value !== null && Math.abs(p - pendingSeek.value) < 1) {
      pendingSeek.value = null
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        pendingTimer = null
      }
    }
  }
)

onBeforeUnmount(() => {
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = null
})

function onSeekInput(event: Event): void {
  seeking.value = true
  const total = player.duration
  seekValue.value = total > 0 ? (Number((event.target as HTMLInputElement).value) / total) * 100 : 0
}

function onSeekCommit(event: Event): void {
  const seconds = Number((event.target as HTMLInputElement).value)
  const total = player.duration
  const percent = total > 0 ? (seconds / total) * 100 : 0
  seekValue.value = percent
  holdSeekTarget(percent)
  player.seek(seconds)
  seeking.value = false
  syncSeekInput()
}

/**
 * 旧的「低频基准 + 字符串绑定」方案已删除 ——
 * 它仍然每秒写一次 value（1 次布局/秒），换成「不绑 value + 在 focus/keydown/换歌时同步」
 * 之后，播放期间对 range 的写入为 0。
 */

function onVolume(event: Event): void {
  player.setVolume(Number((event.target as HTMLInputElement).value) / 100)
}

async function toggleFavorite(): Promise<void> {
  const song = player.current
  if (!song) return
  await library.toggleFavorite(song)
}

async function downloadCurrent(): Promise<void> {
  const song = player.current
  if (!song) return
  await downloads.add([song], { quality: player.quality })
}

/* ------------------------------ 加入歌单 ------------------------------ */

const menuOpen = ref(false)
const menuAnchor = ref<HTMLElement | null>(null)

function openPlaylistMenu(event: MouseEvent): void {
  if (!player.current) return
  menuAnchor.value = event.currentTarget as HTMLElement
  menuOpen.value = true
}
</script>

<template>
  <footer class="player-bar">
    <!--
      进度条常驻显示。

      之前它是一条 3px 的暗色线，圆点还要悬停才出现 —— 结果就是「没进度条，
      鼠标放上去才看得见进度」。现在改成自己画的进度：底槽常显，
      已播放段用亮色填充，拖动圆点始终可见。
      仍然保留原生 input[type=range] 负责交互（键盘、拖动、无障碍都靠它），
      只是把它的外观全部换成我们自己的那层。

      进度值只通过 CSS 变量 `--p`（0~100 的纯数字）下发，填充与圆点各自用
      transform 取值 —— 不再写 width / left，那两个是布局属性，每次更新都要重排。
    -->
    <div class="progress-track" :class="{ seeking, 'no-motion': noMotion }">
      <div class="progress-rail" ref="railEl" :style="{ '--p': displayProgress, '--track-w': railWidth }">
        <div class="progress-fill"></div>
        <div class="progress-knob"></div>
      </div>
      <!--
        刻度是「秒」：min=0 / max=时长 / **step=0.1**（细刻度保点击精度，
        键盘的 5 秒步进在 onSeekKeydown 里显式实现，两者解耦）。
        不绑 :value：播放期间对 range 的写入为 0（写 value 会重排输入框影子树），
        基准改在 focus / keydown / 换歌 / 播放状态变化时同步。
      -->
      <input
        ref="seekInputEl"
        class="progress-input"
        type="range"
        min="0"
        :max="seekMax"
        step="5"
        :disabled="!player.current || player.duration <= 0"
        aria-label="播放进度"
        @focus="syncSeekInput"
        @keydown="onSeekKeydown"
        @input="onSeekInput"
        @change="onSeekCommit"
      />
    </div>

    <div class="bar-body">
      <!-- 左：当前曲目（点击进入正在播放页） -->
      <router-link
        class="now"
        to="/now-playing"
        title="查看大图与歌词"
        style="text-decoration: none; color: inherit"
      >
        <div class="cover">
          <CoverImage
            :src="player.current?.picUrl"
            :song="player.current ?? undefined"
            :icon-size="20"
            fallback
          />
        </div>

        <div class="now-text">
          <template v-if="player.current">
            <div class="now-title ellipsis">{{ player.current.name }}</div>
            <div class="now-sub ellipsis">
              {{ player.current.singer }}
              <span class="faint">· {{ platformName }}</span>
            </div>
          </template>
          <template v-else>
            <div class="now-title faint">未在播放</div>
            <div class="now-sub faint">在搜索页点一首歌开始</div>
          </template>
        </div>
      </router-link>

      <!-- 中：传输控制 -->
      <div class="controls">
        <div class="buttons">
          <button
            class="ctrl"
            title="上一首"
            :disabled="player.playlist.length === 0"
            @click="player.playPrev()"
          >
            <AppIcon name="prev" :size="18" />
          </button>

          <button
            class="ctrl main"
            :title="player.playing ? '暂停' : '播放'"
            :disabled="!player.current || player.loading"
            @click="player.toggle()"
          >
            <AppIcon :name="player.playing ? 'pause' : 'play'" :size="18" />
          </button>

          <button
            class="ctrl"
            title="下一首"
            :disabled="player.playlist.length === 0"
            @click="player.playNext()"
          >
            <AppIcon name="next" :size="18" />
          </button>
        </div>

        <div class="time-row mono">
          <span>{{ formatTime(player.currentTime) }}</span>
          <span class="faint">/ {{ formatTime(player.duration) }}</span>
        </div>
      </div>

      <!-- 右：音质 / 模式 / 收藏 / 下载 / 音量 -->
      <div class="tools">
        <span v-if="player.urlInfo" class="tag accent" :title="`由音源「${player.urlInfo.sourceName}」提供`">
          {{ qualityLabel }}
        </span>
        <span v-if="player.urlInfo" class="src-name ellipsis" :title="player.urlInfo.sourceName">
          {{ player.urlInfo.sourceName }}
        </span>

        <button class="icon-btn" :title="player.modeLabel" @click="player.cycleMode()">
          <AppIcon :name="MODE_ICON[player.mode]" :size="16" />
        </button>

        <button
          class="icon-btn"
          :class="{ on: isCurrentFavorite }"
          :disabled="!player.current"
          :title="isCurrentFavorite ? '取消收藏' : '收藏到我的喜欢'"
          @click="toggleFavorite"
        >
          <AppIcon :name="isCurrentFavorite ? 'heart-filled' : 'heart'" :size="16" :filled="isCurrentFavorite" />
        </button>

        <button
          class="icon-btn"
          :disabled="!player.current"
          title="把当前歌曲加入歌单"
          @click="openPlaylistMenu"
        >
          <AppIcon name="playlist" :size="16" />
        </button>

        <button class="icon-btn" :disabled="!player.current" title="下载当前歌曲" @click="downloadCurrent">
          <AppIcon name="download" :size="16" />
        </button>

        <input
          class="volume"
          type="range"
          min="0"
          max="100"
          :value="String(Math.round(player.volume * 100))"
          title="音量"
          @input="onVolume"
        />
      </div>
    </div>

    <!-- 错误提示：音源失效时给出明确反馈；入场/出场走 motion.css 的 rise（只动 opacity/transform） -->
    <Transition name="rise">
      <div v-if="player.error" class="error-strip">
        <span class="ellipsis">{{ player.error }}</span>
        <button class="ghost small" @click="player.error = null">知道了</button>
      </div>
    </Transition>

    <!-- 加入歌单：面板挂在 body 上，位置跟着上面那个按钮 -->
    <PlaylistMenu
      v-if="menuOpen && player.current"
      :songs="[player.current]"
      :anchor="menuAnchor"
      @close="menuOpen = false"
    />
  </footer>
</template>

<style scoped>
.player-bar {
  position: relative;
  height: var(--playerbar-h);
  /* 顶部 1px 刻线取代原来的边框色 */
  border-top: 1px solid var(--hairline);
  background: var(--surface-1);
}

/* ------------------------------ 进度 ------------------------------ */

/**
 * 命中区 24px（WCAG 2.5.8）：视觉轨道只有 2px，但整个 track 与原生 range
 * 都是 24px 高 —— 细线好看，手指/鼠标不必去找那条线。
 */
.progress-track {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: var(--sp-5);
  display: flex;
  align-items: center;
  padding: 0 var(--sp-4);
}

/* 底槽：未播放段。2px 细刻线，零圆角 */
.progress-rail {
  position: relative;
  width: 100%;
  height: 2px;
  background: var(--hairline);
  /**
   * 本地默认 0：契约把进度轨道宽度改名为 `--track-w`，与 style.css 里表示
   * 「图标导航柱宽度」的 `--rail-w`(64px) 彻底分开。万一内联值没绑上，
   * 滑块宁可停在起点，也不能按 64px 乱跑。
   */
  --track-w: 0;
  /**
   * 已评估例外（见 styles/motion.css 第 1 条）：保留 height 过渡。
   * 只有 2px→4px、只在悬停时发生、频率极低；scaleY 会把两端拉变形。
   */
  transition: height var(--dur-1) var(--ease-out);
}

/**
 * 已播放段：青铜 2px，从左边长出来。
 *
 * 元素常驻满宽，进度只由 `--p`（0~100）经 transform 缩放决定 ——
 * 宽度不再是动画属性，更新不再触发布局（实测 1.025 次/更新 → 0.025 的地板值）。
 */
.progress-fill {
  position: absolute;
  inset: 0;
  background: var(--progress);
  transform-origin: left center;
  transform: scaleX(calc(var(--p, 100) / 100));
  transition: transform var(--dur-3) var(--ease-out);
}

/**
 * 方头滑块：零圆角体系里的「刻刀」。
 * 8×12 的硬边青铜方块，外面一圈同底色的描边把它从填充里切出来（不用阴影）。
 * 位置由 transform 驱动（见下），命中区由上面的 24px track 兜住。
 */
.progress-knob {
  --knob-size: 8px;
  position: absolute;
  top: 50%;
  left: 0;
  width: var(--knob-size);
  height: 12px;
  margin-left: calc(var(--knob-size) / -2);
  border-radius: var(--r-card);
  background: var(--progress);
  border: 2px solid var(--surface-1);
  /**
   * 位置 = 进度比例 × 轨道宽度。
   * 契约里 `--track-w` 是「不带单位的数字」，必须补 `* 1px` 才成长度 ——
   * 否则整条 transform 会被丢弃、滑块不动。`-50%` 的 Y 也不能省。
   */
  transform: translate3d(calc(var(--p, 0) * var(--track-w, 0) * 1px / 100), -50%, 0)
    scale(var(--knob-scale, 0.9));
  transition: transform var(--dur-3) var(--ease-out);
  pointer-events: none;
}

.progress-track:hover .progress-knob,
.progress-track.seeking .progress-knob {
  --knob-scale: 1.15;
}

.progress-track:hover .progress-rail,
.progress-track.seeking .progress-rail {
  height: 4px;
  background: var(--hairline-strong);
}

/* 交互层：透明，盖满 24px 命中区 */
.progress-input {
  position: absolute;
  left: var(--sp-4);
  right: var(--sp-4);
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

.progress-input:disabled {
  cursor: default;
}

/* 轨道和滑块都自绘，这里把原生外观藏掉（只留命中区） */
.progress-input::-webkit-slider-runnable-track {
  height: var(--sp-5);
  background: transparent;
}

/**
 * 原生滑块必须是**窄**的（2px）：Chromium 的 range 把可点区间按「半个滑块宽」
 * 内缩，滑块 24px 时点 20% 会被算成 ~18.8%（600px 轨道上偏 7px）。
 * 命中区由元素自身的 24px 高度保证，不靠滑块宽度 —— 所以这里收窄只影响映射精度。
 */
.progress-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 2px;
  height: var(--sp-5);
  border-radius: var(--r-card);
  background: transparent;
}

/* ------------------------------ 主体 ------------------------------ */

.bar-body {
  display: grid;
  grid-template-columns: minmax(200px, 1fr) auto minmax(200px, 1fr);
  align-items: center;
  gap: var(--sp-4);
  /**
   * 顶部让出进度轨道那一条 24px 命中带（用户实测反馈：播放键与进度条重合）。
   * 外壳用 `calc(100vh - var(--playerbar-h))` 算内容高度，所以播放条必须严格
   * 保持 --playerbar-h（78px）高，只能在这 78px 里把两行分开 ——
   * 命中带 24px + 控制列 52px（见下方 .ctrl/.time-row 的尺寸）= 76px，正好留 2px 余量。
   */
  height: 100%;
  padding: var(--sp-5) var(--sp-4) 0;
}

.now {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-width: 0;
  cursor: pointer;
}

/* 缩略图：零圆角硬边 + 刻线 */
.cover {
  flex: none;
  width: 46px;
  height: 46px;
  border-radius: var(--r-card);
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  display: grid;
  place-items: center;
  color: var(--ink-faint);
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.now-text {
  min-width: 0;
  line-height: var(--lh-tight);
}

.now-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--ink);
}

.now-sub {
  font-size: var(--fs-xs);
  color: var(--ink-muted);
}

/* ------------------------------ 控制 ------------------------------ */

.controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-1);
}

.buttons {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

/**
 * 按钮尺寸压到「36 + 4 + 12 = 52px」是为了塞进 78px 里剩下的 54px 空间
 * （上面 24px 给了进度命中带）。36px 仍远大于 24px 命中标准，主按钮依旧是最大控件。
 */
.ctrl {
  width: 28px;
  height: 28px;
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
  transform: scale(0.94);
}

.ctrl.main {
  width: 36px;
  height: 36px;
  border-radius: var(--r-ctl);
  background: var(--accent);
  color: var(--on-accent);
}

.ctrl.main:hover:not(:disabled) {
  background: var(--accent-hover);
  color: var(--on-accent);
}

.ctrl:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.time-row {
  font-size: var(--fs-xs);
  color: var(--ink-muted);
  letter-spacing: var(--ls-normal);
  /* 行高收到 1：这一行只有 12px 高，控制列才能塞进 52px */
  line-height: 1;
}

/* ------------------------------ 工具区 ------------------------------ */

.tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-2);
  min-width: 0;
}

.icon-btn {
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: var(--r-ctl);
  background: transparent;
  border: none;
  color: var(--ink-muted);
  display: grid;
  place-items: center;
  transition:
    background-color var(--dur-1) var(--ease-out),
    color var(--dur-1) var(--ease-out);
}

.icon-btn:hover:not(:disabled) {
  background: var(--surface-3);
  color: var(--ink);
}

/* 当前状态用青铜；它落在 surface-1 上（对比度达标 4.53:1） */
.icon-btn.on {
  color: var(--accent);
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.src-name {
  max-width: 110px;
  font-size: var(--fs-xs);
  color: var(--ink-subtle);
}

/* 音量：可见轨道仍是 3px，命中区 24px */
.volume {
  width: 76px;
  height: var(--sp-5);
  /* 去掉 UA 给 range 的默认 2px margin：全页最后一批离网值之一 */
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}

.volume::-webkit-slider-runnable-track {
  height: 3px;
  background: var(--hairline);
  border-radius: var(--r-card);
}

.volume::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 10px;
  height: 10px;
  /* 几何补偿：让滑块在 3px 轨道上垂直居中 */
  margin-top: -3.5px;
  border-radius: var(--r-card);
  background: var(--accent);
}

/* ------------------------------ 错误条 ------------------------------ */

.error-strip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-4);
  background: var(--danger-soft);
  border-top: 1px solid var(--danger-line);
  font-size: var(--fs-xs);
  color: var(--danger-text);
}

.small {
  font-size: var(--fs-xs);
}
</style>
