<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { DownloadTask } from '@shared/types/download'
import { PLATFORM_META, QUALITY_META } from '@shared/constants'
import { useDownloadStore } from '../stores/downloads'
import { formatBytes, formatSpeed } from '../utils/format'

const downloads = useDownloadStore()

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
    </header>

    <div v-if="downloads.tasks.length === 0" class="empty">
      <span>还没有下载任务</span>
      <span class="faint small-text">在搜索页点某首歌右侧的 ↓ 即可加入</span>
    </div>

    <div v-else class="list">
      <div v-for="task in downloads.tasks" :key="task.id" class="task" :class="task.status">
        <div class="cover" :class="{ empty: !task.song.picUrl }">
          <img v-if="task.song.picUrl" :src="task.song.picUrl" alt="" />
          <span v-else class="mono">MH</span>
        </div>

        <div class="info">
          <div class="line1">
            <span class="name ellipsis" :title="task.fileName">{{ task.song.name }}</span>
            <span class="tag" :class="statusClass(task)">{{ STATUS_LABEL[task.status] ?? task.status }}</span>
            <span class="tag">{{ QUALITY_META[task.quality]?.short ?? task.quality }}</span>
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
            v-if="task.status === 'done'"
            class="ghost small"
            title="播放"
            @click="openTask(task)"
          >
            打开
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
