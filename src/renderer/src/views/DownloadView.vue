<script setup lang="ts">
import { computed, onMounted } from 'vue'
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
    <header class="header">
      <div class="title-row">
        <h2>下载</h2>
        <span class="faint small-text">
          {{ downloads.tasks.length }} 个任务
          <template v-if="running"> · {{ downloads.activeTasks.length }} 个进行中</template>
        </span>
      </div>

      <div class="actions">
        <button class="ghost small" :disabled="!running" @click="pauseAll">全部暂停</button>
        <button
          class="ghost small"
          :disabled="!downloads.tasks.some((t) => t.status === 'paused')"
          @click="resumeAll"
        >
          全部继续
        </button>
        <button
          class="ghost small"
          :disabled="downloads.failedTasks.length === 0"
          @click="retryFailed"
        >
          重试失败 ({{ downloads.failedTasks.length }})
        </button>
        <button
          class="ghost small"
          :disabled="downloads.finishedTasks.length === 0"
          @click="downloads.clearFinished()"
        >
          清除已完成
        </button>
        <div class="grow"></div>
        <button class="ghost small" @click="downloads.chooseDir()">
          {{ downloads.config?.dir ? '更换目录' : '选择目录' }}
        </button>
      </div>

      <div v-if="downloads.config?.dir" class="dir-line mono faint ellipsis">
        {{ downloads.config.dir }}
      </div>

      <!--
        下载格式：直接摆在最显眼的位置。
        以前要改格式得专门跑一趟设置页、还得先弄懂「首选音质」是什么意思。
      -->
      <div class="format-block">
        <div class="format-head">
          <span class="format-label">下载格式</span>
          <span class="faint small-text">选好后，搜索页点 ↓ 就按这个格式下</span>
        </div>
        <DownloadFormatPicker
          :model-value="downloads.config?.preferQuality"
          :disabled="!downloads.config"
          @update:model-value="downloads.setFormat"
        />
      </div>
    </header>

    <div v-if="downloads.tasks.length === 0" class="empty">
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

          <div class="progress-line">
            <div class="bar grow">
              <i :style="{ width: `${task.progress}%` }" />
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
.view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.header {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-bottom: 1px solid var(--line);
}

.title-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.title-row h2 {
  font-size: 17px;
}

.small-text {
  font-size: 11.5px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dir-line {
  font-size: 11px;
}

/* ------------------------------ 下载格式 ------------------------------ */

.format-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 0 2px;
  border-top: 1px solid var(--line);
}

.format-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.format-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.warn-tag {
  border-color: color-mix(in srgb, #e0a336 60%, transparent);
  color: #e0a336;
}

/* ------------------------------ 列表 ------------------------------ */

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 18px 18px;
}

.task {
  display: grid;
  grid-template-columns: 52px 1fr auto;
  gap: 14px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--line-soft);
}

.task.error {
  background: linear-gradient(90deg, rgba(212, 87, 76, 0.06), transparent 60%);
}

.cover {
  width: 52px;
  height: 52px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover.empty .mono {
  font-size: 11px;
  color: var(--text-faint);
}

.info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.line1 {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.name {
  font-size: 13.5px;
  font-weight: 600;
}

.line2 {
  font-size: 11.5px;
}

.progress-line {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
}

.num {
  min-width: 52px;
  text-align: right;
}

.err-line {
  font-size: 11.5px;
  color: #e79a92;
}

.ops {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
