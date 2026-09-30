<script setup lang="ts">
import { computed, onMounted, onUpdated } from 'vue'
import type { DownloadTask } from '@shared/types/download'
import type { Quality, Song } from '@shared/types/music'
import {
  PLATFORM_META,
  QUALITY_META,
  containerOf,
  findFormat
} from '@shared/constants'
import { useDownloadStore } from '../stores/downloads'
import { usePlayerStore } from '../stores/player'
import { formatBytes, formatSpeed } from '../utils/format'
import DownloadFormatPicker from '../components/DownloadFormatPicker.vue'

const downloads = useDownloadStore()
const player = usePlayerStore()

/** Vue 模板作用域看不到全局 window，显式暴露给模板用 */
const api = window.api

const STATUS_LABEL: Record<string, string> = {
  waiting: '排队中',
  pending: '准备中',
  downloading: '下载中',
  paused: '已暂停',
  done: '已完成',
  error: '失败',
  cancelled: '已取消'
}

const running = computed(() => downloads.activeTasks.length > 0)

/**
 * 「进度回退」判定 —— 回退当帧必须瞬断，绝不能演成倒放。
 *
 * 为什么要单独判、而不是只看 `progress <= 0`：
 * 实测（scripts/ui-probe-progress-frames.mjs，逐帧采样 + 逐帧记录 transition 状态）
 * 抓到过一次真实的倒放：主进程换源丢弃残留后把进度清零，但**推给渲染层的第一个值
 * 是 0.1% 而不是 0**（restart 后立刻收到了一小段数据）。于是 `progress <= 0` 不成立、
 * `.no-motion` 没挂上，进度条用 520ms 从 688px 平滑缩回 226px —— 整整 88 帧的倒退动画。
 *
 * 所以判据必须是「**比上一帧小**」，而不是「等于 0」。
 * 实现上不引 watcher、不做深比较：模板渲染时顺手记一份当前值，onUpdated 时翻页成
 * 「上一帧」。两个普通 Map（非响应式），每个任务一次 get/set，成本可以忽略；
 * 也避免了 deep watcher 去遍历整个 tasks（里面还挂着 song.raw）。
 */
const REWIND_EPSILON = 0.05 // 容忍百分比保留一位小数带来的抖动
let prevProgress = new Map<string, number>()
let curProgress = new Map<string, number>()

function isRewind(task: DownloadTask): boolean {
  curProgress.set(task.id, task.progress)
  const prev = prevProgress.get(task.id)
  return prev !== undefined && task.progress + REWIND_EPSILON < prev
}

onUpdated(() => {
  // 只保留仍在列表里的任务，避免删掉的任务把 id 永远留在 Map 里
  const alive = new Set(downloads.tasks.map((t) => t.id))
  for (const id of curProgress.keys()) if (!alive.has(id)) curProgress.delete(id)
  prevProgress = curProgress
  curProgress = new Map()
})

onMounted(async () => {
  await downloads.loadConfig()
  await downloads.refresh()
})

function statusClass(task: DownloadTask): string {
  if (task.status === 'done') return 'ok'
  if (task.status === 'error') return 'err'
  if (task.status === 'downloading') return 'accent'
  return ''
}

/**
 * 这一行显示「实际拿到的是什么格式」。
 *
 * 下载中还没落盘，就显示你选的那个格式；下完了一律按文件扩展名说话 ——
 * 音源常常嘴上答应 FLAC、给的却是 M4A，与其显示期望值，不如显示事实。
 */
function formatTag(task: DownloadTask): string {
  if (task.status === 'done' || task.status === 'error') {
    return containerOf(task.fileName)
  }
  return formatLabel(task.quality)
}

function formatLabel(quality: Quality | undefined): string {
  const f = findFormat(quality)
  return f ? `${f.format} ${f.rate}` : (QUALITY_META[quality ?? '']?.short ?? quality ?? '—')
}

function isLosslessTask(task: DownloadTask): boolean {
  if (task.status === 'done') {
    return ['FLAC', 'WAV', 'ALAC'].includes(containerOf(task.fileName))
  }
  return findFormat(task.quality)?.lossless ?? false
}

/**
 * 「你要的」和「实际拿到的」对不上时给出说明文案，对得上就返回 null。
 *
 * 音源经常口是心非：要 MP3 给 M4A、要无损给有损。不说清楚的话，
 * 用户只会觉得「我明明选了 MP3，怎么下出来个 m4a，是不是坏了」。
 * 这里只负责措辞，配色交给调用方的 warn-tag。
 */
function mismatchNote(task: DownloadTask): string | null {
  if (task.status !== 'done') return null
  const want = findFormat(task.quality)
  const got = containerOf(task.fileName)
  if (!want || got.toLowerCase() === want.ext) return null
  return `你要的是 ${want.format} ${want.rate}，音源实际给的是 ${got} 容器。音频本身是完整可播的，只是封装格式不同。`
}

/**
 * 音源没给到你要的档位时为真（例如选了 24bit 母带、只拿到 320K）。
 * 同为无损档位之间的差别不值得啰嗦，只报真正的降级。
 */
function downgradeNote(task: DownloadTask): string | null {
  if (!task.actualQuality || !task.quality || task.actualQuality === task.quality) return null
  const want = findFormat(task.quality)
  const got = findFormat(task.actualQuality)
  if (want?.lossless && got?.lossless && want.format === got.format) return null
  return `你选的是 ${want ? `${want.format} ${want.rate}` : task.quality}，音源最高只给到 ${
    got ? `${got.format} ${got.rate}` : task.actualQuality
  }。`
}

async function pauseAll(): Promise<void> {
  await downloads.pause(downloads.activeTasks.map((t) => t.id))
}

async function resumeAll(): Promise<void> {
  await downloads.resume(downloads.tasks.filter((t) => t.status === 'paused').map((t) => t.id))
}

async function retryFailed(): Promise<void> {
  await downloads.retry(downloads.failedTasks.map((t) => t.id))
}

async function removeTask(task: DownloadTask, deleteFile: boolean): Promise<void> {
  await downloads.remove([task.id], deleteFile)
}

async function openTask(task: DownloadTask): Promise<void> {
  try {
    await api.download.openFile(task.savePath)
  } catch {
    await api.download.showInFolder(task.savePath)
  }
}

/**
 * 在应用内播放已下载的文件。
 *
 * 之前的「播放」按钮其实是把文件丢给系统默认播放器（在用户机器上关联的是
 * 网易云音乐）—— 点下去弹出去一个别的软件，用起来既不像播放、
 * 也谈不上「下载完就能听」。现在直接在本应用里播，走本地流代理。
 */
async function playTask(task: DownloadTask): Promise<void> {
  if (task.status !== 'done') return

  /**
   * 播放前先确认文件真的还在。
   *
   * 「任务写着已完成、点播放却没声音」绝大多数不是解码问题，而是文件已经不在
   * 那个路径上了（被同名任务覆盖、被手动清理、被移动）。与其让音频元素报一个
   * 笼统的失败，不如在这里就说清楚，并且直接把「重新下载」摆在眼前。
   */
  const audit = await api.download.audit()
  const state = audit?.[task.id]
  if (state && !state.exists) {
    downloads.markMissing(task.id, true)
    window.alert(
      `这个文件已经不在磁盘上了：\n${task.savePath}\n\n` +
        `多半是被同名任务覆盖、或已被移动到别处。\n点「重新下载」可以重新拿一份。`
    )
    return
  }

  const song = localSongOf(task)

  /**
   * 队列要跟着一起换。
   *
   * 只改 current 而不动队列的话，currentIndex 还指着上一批歌，
   * 按「下一首」会跳到毫不相干的位置去。所以这里把全部已下载的文件
   * 当成一个播放列表传进去 —— 下完的歌连起来听，本来也是最自然的用法。
   */
  const list = downloads.tasks.filter((t) => t.status === 'done').map(localSongOf)
  await player.play(song, list)
}

/** 文件丢失时的一键补救：按原来的歌曲信息重新入库下载 */
async function redownload(task: DownloadTask): Promise<void> {
  await downloads.remove([task.id], false)
  await downloads.add([task.song], { quality: task.quality })
}

/**
 * 把下载任务映射成一首「本地歌曲」。
 *
 * id 与 songmid 都换成文件路径，这样同一首歌的不同文件（比如两个音质版本）
 * 在播放队列里也是两条独立记录，不会互相顶掉。
 */
function localSongOf(task: DownloadTask): Song {
  return {
    ...task.song,
    id: `local_${task.savePath}`,
    platform: 'local',
    songmid: task.savePath,
    localPath: task.savePath,
    albumName: task.song.albumName || '',
    duration: task.song.duration || 0,
    qualities: task.song.qualities?.length ? task.song.qualities : ['320k']
  }
}

/** 当前是否正在播放这条本地记录 */
function isPlayingTask(task: DownloadTask): boolean {
  return player.current?.id === `local_${task.savePath}`
}
</script>

<template>
  <section class="view">
    <!--
      页面级操作注入顶栏右侧（外壳的 #page-actions）。
      页面标题由外壳按 route.meta.title 渲染 —— 视图不许再画自己的大标题，
      否则会出现「顶栏一个标题 + 内容区一个标题」的双标题中间态。
    -->
    <Teleport to="#page-actions">
      <span class="count num">
        {{ downloads.tasks.length }} 个任务<template v-if="running"> · {{ downloads.activeTasks.length }} 进行中</template>
      </span>
      <button class="ghost" :disabled="!running" @click="pauseAll">全部暂停</button>
      <button
        class="ghost"
        :disabled="!downloads.tasks.some((t) => t.status === 'paused')"
        @click="resumeAll"
      >
        全部继续
      </button>
      <button class="ghost" :disabled="downloads.failedTasks.length === 0" @click="retryFailed">
        重试失败 ({{ downloads.failedTasks.length }})
      </button>
      <button
        class="ghost"
        :disabled="downloads.finishedTasks.length === 0"
        @click="downloads.clearFinished()"
      >
        清除已完成
      </button>
    </Teleport>

    <!--
      工具条：下载目录 + 下载格式。
      左右留白由外壳 .page 统一负责（40px），视图不再自己加水平 padding，
      否则会叠加成 80px。分区靠 1px 刻线，不靠卡片与阴影。
    -->
    <div class="toolbar">
      <div class="dir-row">
        <span class="mono dir-line ellipsis" :title="downloads.config?.dir ?? ''">
          {{ downloads.config?.dir ?? '未设置下载目录' }}
        </span>
        <button class="ghost" @click="downloads.chooseDir()">
          {{ downloads.config?.dir ? '更换目录' : '选择目录' }}
        </button>
      </div>

      <div class="format-block">
        <div class="format-head">
          <span class="format-label">下载格式</span>
          <span class="hint">选好后，搜索页点 ↓ 就按这个格式下</span>
        </div>
        <DownloadFormatPicker
          :model-value="downloads.config?.preferQuality"
          :disabled="!downloads.config"
          @update:model-value="downloads.setFormat"
        />
      </div>
    </div>

    <!--
      骨架屏只用于「正在读磁盘上的任务列表」这一小段真实等待，
      不是拿来冒充空态：没有任务时要说人话，不能一直闪骨架。
    -->
    <div
      v-if="downloads.tasks.length === 0 && downloads.loading"
      class="skeleton-list"
      aria-hidden="true"
    >
      <div v-for="n in 3" :key="n" class="skeleton-row">
        <div class="skeleton skeleton-thumb"></div>
        <div class="skeleton-lines">
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line short"></div>
        </div>
      </div>
    </div>

    <div v-else-if="downloads.tasks.length === 0" class="empty">
      <span>还没有下载任务</span>
      <span class="faint small-text">在搜索页点某首歌右侧的 ↓ 即可加入</span>
    </div>

    <div v-else class="list">
      <div v-for="task in downloads.tasks" :key="task.id" class="task" :class="task.status">
        <div class="cover">
          <CoverImage :src="task.song.picUrl" :icon-size="20" />
        </div>

        <div class="info">
          <div class="line1">
            <span class="name ellipsis" :title="task.fileName">{{ task.song.name }}</span>
            <span class="tag" :class="statusClass(task)">{{ STATUS_LABEL[task.status] ?? task.status }}</span>
            <!--
              格式标签只留一个：完成后显示真实拿到的容器，
              和你选的不一致时变琥珀色并把差别写进提示里 —— 不重复堆两个标签。
            -->
            <span
              class="tag"
              :class="{ accent: isLosslessTask(task), 'warn-tag': !!mismatchNote(task) }"
              :title="mismatchNote(task) ?? ''"
            >
              {{ formatTag(task) }}
            </span>
            <span
              v-if="downgradeNote(task)"
              class="tag warn-tag"
              :title="downgradeNote(task) ?? ''"
            >
              已降级
            </span>
          </div>

          <div class="line2 faint ellipsis">
            {{ task.song.singer }}
            <span>· {{ PLATFORM_META[task.song.platform]?.name ?? task.song.platform }}</span>
            <span v-if="task.sourceName"> · 音源 {{ task.sourceName }}</span>
          </div>

          <!--
            进度条填充：用 --p（0~100 的纯数字）驱动 transform，**不再写内联 width**。
            内联 width 的优先级高于样式表，会把 style.css 的 `width:100%` 盖掉，
            于是每帧仍在写布局属性（LayoutCount/RecalcStyleCount 白涨），
            合成层那点收益一点也拿不到 —— 也就是「半迁移」。

            瞬断条件有两层：
              · progress <= 0        —— 还没开始 / 刚刚归零
              · isRewind(task)       —— 进度比上一帧小（换源丢弃残留、重试重下）
            第二层是逐帧实测抓出来的：归零后推过来的第一个值可能是 0.1% 而不是 0，
            只看第一层会漏判，进度条就会用 520ms 倒着缩回去。
          -->
          <div
            class="progress-line"
            :class="{ 'no-motion': task.progress <= 0 || isRewind(task) }"
          >
            <div class="bar grow">
              <i :style="{ '--p': task.progress }" />
            </div>
            <span class="mono num">{{ task.progress.toFixed(1) }}%</span>
            <span class="mono num dim">
              {{ formatBytes(task.received) }}<template v-if="task.total > 0"> / {{ formatBytes(task.total) }}</template>
            </span>
            <span class="mono num dim">{{ formatSpeed(task.speed) }}</span>
          </div>

          <div v-if="task.error" class="err-line ellipsis" :title="task.error">{{ task.error }}</div>

          <div
            v-if="task.status === 'done' && downloads.missingFiles.has(task.id)"
            class="err-line"
            title="任务记录说已完成，但磁盘上已经找不到这个文件"
          >
            文件已丢失（可能被同名任务覆盖或已移动）—— 点右侧「重新下载」拿一份新的
          </div>
        </div>

        <div class="ops">
          <button
            v-if="task.status === 'downloading' || task.status === 'waiting' || task.status === 'pending'"
            class="ghost small"
            title="暂停"
            @click="downloads.pause([task.id])"
          >
            暂停
          </button>
          <button
            v-if="task.status === 'paused'"
            class="ghost small"
            title="继续"
            @click="downloads.resume([task.id])"
          >
            继续
          </button>
          <button
            v-if="task.status === 'error' || task.status === 'cancelled'"
            class="ghost small"
            title="重试"
            @click="downloads.retry([task.id])"
          >
            重试
          </button>
          <button
            v-if="task.status === 'done' && downloads.missingFiles.has(task.id)"
            class="ghost small danger"
            title="文件已不在磁盘上，重新下载一份"
            @click="redownload(task)"
          >
            重新下载
          </button>
          <button
            v-if="task.status === 'done' && !downloads.missingFiles.has(task.id)"
            class="ghost small"
            :class="{ active: isPlayingTask(task) }"
            title="在应用内播放这个文件"
            @click="playTask(task)"
          >
            {{ isPlayingTask(task) ? '播放中' : '播放' }}
          </button>
          <button
            v-if="task.status === 'done'"
            class="ghost small"
            title="用系统默认播放器打开"
            @click="openTask(task)"
          >
            用系统播放器
          </button>
          <button
            v-if="task.status === 'done'"
            class="ghost small"
            title="在文件夹中显示"
            @click="api.download.showInFolder(task.savePath)"
          >
            定位
          </button>
          <button class="ghost small danger" title="移除任务" @click="removeTask(task, false)">
            移除
          </button>
          <button
            v-if="task.status === 'done'"
            class="ghost small danger"
            title="移除任务并删除文件"
            @click="removeTask(task, true)"
          >
            删文件
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/*
 * 下载页样式 —— 全部取值来自 token 层，本文件不出现任何手写颜色 / 字号 / 时长。
 *
 * 分区语言：1px 刻线 + 留白 + 字重反差。
 * 外壳 .page 已经给了左右 40px 留白，所以这里**不再写任何水平 padding**。
 * 零阴影、零圆角（控件最多 --r-ctl 2px）—— 层次由刻线承担。
 */
.view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 顶栏右侧的任务计数（.num 已给等宽 tabular-nums） */
.count {
  color: var(--ink-subtle);
  white-space: nowrap;
}

/* ------------------------------ 工具条 ------------------------------ */

.toolbar {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding-bottom: var(--sp-4);
  border-bottom: 1px solid var(--hairline);
}

.dir-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.dir-line {
  color: var(--ink-subtle);
}

.format-block {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.format-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
}

/* 小标题用碑刻衬线 + 疏排，和外壳顶栏是同一套语言 */
.format-label {
  font-family: var(--font-display);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-wide);
  text-transform: uppercase;
  color: var(--ink);
}

.hint {
  font-size: var(--fs-xs);
  color: var(--ink-subtle);
}

.small-text {
  font-size: var(--fs-xs);
}

/*
 * 「和你选的不一样」用 danger 的成对 token。
 * 不用强调色：青铜是「当前状态 / 可行动」的意思，拿来标警告会互相打架。
 */
.warn-tag {
  border-color: var(--danger-line);
  color: var(--danger-text);
}

/* ------------------------------ 骨架屏 ------------------------------ */

.skeleton-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: var(--sp-4);
}

.skeleton-row {
  display: grid;
  grid-template-columns: var(--sp-7) 1fr;
  gap: var(--sp-4);
  align-items: center;
  padding: var(--sp-4) 0;
  border-bottom: 1px solid var(--hairline-soft);
}

.skeleton-thumb {
  width: var(--sp-7);
  height: var(--sp-7);
}

.skeleton-lines {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.skeleton-line {
  height: var(--sp-3);
  width: 60%;
}

.skeleton-line.short {
  width: 32%;
}

/* ------------------------------ 空态 ------------------------------ */

/* 撑满工具条以下的剩余空间，空态居中而不是贴在工具条下面 */
.empty {
  flex: 1;
}

/* ------------------------------ 列表 ------------------------------ */

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-top: var(--sp-4);
}

/*
 * 任务行：状态用**左侧 2px 竖线**表达（与外壳导航当前项的标记同一种语言）。
 * 竖线是绝对定位的伪元素：不参与 grid 布局，只动 transform / 背景色，
 * 所以出现与消失都不会让行内元素挪位。
 */
.task {
  position: relative;
  display: grid;
  grid-template-columns: var(--sp-7) 1fr auto;
  gap: var(--sp-4);
  align-items: center;
  padding: var(--sp-4) 0 var(--sp-4) var(--sp-3);
  border-bottom: 1px solid var(--hairline-soft);
}

.task::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 2px;
  height: var(--sp-5);
  margin-top: calc(var(--sp-5) / -2);
  background: var(--hairline-strong);
  transform: scaleY(0);
  transform-origin: center;
  transition:
    transform var(--dur-2) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.task.downloading::before {
  background: var(--accent);
  transform: scaleY(1);
}

.task.pending::before,
.task.waiting::before {
  background: var(--accent);
  opacity: 0.45;
  transform: scaleY(1);
}

.task.done::before {
  background: var(--ok);
  transform: scaleY(1);
}

.task.paused::before {
  background: var(--ink-subtle);
  transform: scaleY(1);
}

.task.error::before,
.task.cancelled::before {
  background: var(--danger);
  transform: scaleY(1);
}

/* 失败行的暖色底：用 danger-soft 而不是手写 rgba */
.task.error {
  background: var(--danger-soft);
}

.cover {
  width: var(--sp-7);
  height: var(--sp-7);
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  display: grid;
  place-items: center;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.line1 {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--ink);
}

.line2 {
  font-size: var(--fs-xs);
  color: var(--ink-subtle);
}

.progress-line {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

/* 数字列宽度固定 + .num 的 tabular-nums，进度跳动时不会把整行推来推去 */
.num {
  min-width: 56px;
  text-align: right;
}

.err-line {
  font-size: var(--fs-xs);
  color: var(--danger-text);
}

.ops {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
}
</style>
