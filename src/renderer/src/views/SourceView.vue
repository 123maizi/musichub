<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { SourceInfo } from '@shared/types/source'
import { PLATFORM_META, QUALITY_META } from '@shared/constants'
import { useSourceStore } from '../stores/sources'

const sources = useSourceStore()

const urlInput = ref('')
const showUrlBox = ref(false)
const expanded = ref<Set<string>>(new Set())
const filter = ref<'all' | 'ready' | 'error'>('all')

const STATUS_TEXT: Record<string, string> = {
  ready: '可用',
  error: '异常',
  loading: '加载中',
  idle: '未加载',
  disabled: '已停用'
}

const visibleSources = computed(() => {
  const list = sources.list
  if (filter.value === 'ready') return list.filter((s) => s.status === 'ready')
  if (filter.value === 'error') return list.filter((s) => s.status === 'error')
  return list
})

const stats = computed(() => ({
  total: sources.list.length,
  ready: sources.readySources.length,
  errors: sources.errorSources.length,
  lossless: sources.losslessCount,
  platforms: sources.coveredPlatforms.length
}))

onMounted(() => {
  void sources.refresh()
})

function toggleExpand(id: string): void {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

/** Vue 模板作用域看不到全局 window，显式暴露给模板用 */
const api = window.api

async function doImportUrl(): Promise<void> {
  const url = urlInput.value.trim()
  if (!url) return
  const result = await sources.importFromUrl(url)
  if (result) {
    urlInput.value = ''
    showUrlBox.value = false
  }
}

async function confirmRemove(source: SourceInfo): Promise<void> {
  if (!window.confirm(`确定移除音源「${source.name}」？此操作会删除该脚本文件。`)) return
  await sources.remove([source.id])
}
</script>

<template>
  <section class="view">
    <header class="header">
      <div class="title-row">
        <h2>音源</h2>
        <span class="faint small-text">音源决定「能不能听、能听到多好」</span>
      </div>

      <div class="stats">
        <div class="stat">
          <span class="num mono">{{ stats.ready }}</span>
          <span class="faint">可用 / {{ stats.total }}</span>
        </div>
        <div class="stat">
          <span class="num mono">{{ stats.lossless }}</span>
          <span class="faint">支持无损</span>
        </div>
        <div class="stat">
          <span class="num mono">{{ stats.platforms }}</span>
          <span class="faint">覆盖平台</span>
        </div>
        <div class="stat" :class="{ danger: stats.errors > 0 }">
          <span class="num mono">{{ stats.errors }}</span>
          <span class="faint">加载失败</span>
        </div>
      </div>

      <div class="actions">
        <button class="primary" :disabled="sources.busy" @click="sources.importFromDialog()">
          从文件导入
        </button>
        <button
          :disabled="sources.busy"
          @click="showUrlBox = !showUrlBox"
        >
          从 URL 导入
        </button>
        <button :disabled="sources.busy" @click="sources.importBundled()">导入内置音源</button>
        <button class="ghost small" @click="sources.refresh()">刷新</button>
        <button class="ghost small" @click="api.source.openDir()">打开目录</button>
        <div class="grow"></div>
        <div class="filter">
          <button
            v-for="f in (['all', 'ready', 'error'] as const)"
            :key="f"
            class="ghost small"
            :class="{ active: filter === f }"
            @click="filter = f"
          >
            {{ f === 'all' ? '全部' : f === 'ready' ? '可用' : '失败' }}
          </button>
        </div>
      </div>

      <div v-if="showUrlBox" class="url-box">
        <input
          v-model="urlInput"
          type="text"
          placeholder="粘贴音源脚本的直链地址（.js）"
          spellcheck="false"
          @keyup.enter="doImportUrl"
        />
        <button class="primary" :disabled="sources.busy || !urlInput.trim()" @click="doImportUrl">
          导入
        </button>
      </div>

      <!-- 导入结果回执 -->
      <div v-if="sources.lastImport" class="import-result">
        <span class="tag ok">成功 {{ sources.lastImport.imported.length }}</span>
        <span v-if="sources.lastImport.skipped.length" class="tag">
          跳过 {{ sources.lastImport.skipped.length }}
        </span>
        <span v-if="sources.lastImport.failed.length" class="tag err">
          失败 {{ sources.lastImport.failed.length }}
        </span>
        <span v-if="sources.lastImport.failed.length" class="faint small-text ellipsis">
          {{ sources.lastImport.failed.map((f) => f.error).join('；') }}
        </span>
      </div>

      <div v-if="sources.error" class="err-box">{{ sources.error }}</div>
    </header>

    <div v-if="sources.loading" class="empty"><span class="mono">正在装载音源…</span></div>

    <div v-else-if="sources.list.length === 0" class="empty">
      <span>还没有任何音源</span>
      <span class="faint small-text">
        点「从文件导入」选择 .js 音源脚本，或「导入内置音源」一键装上一批
      </span>
    </div>

    <div v-else class="list">
      <div v-for="source in visibleSources" :key="source.id" class="item" :class="source.status">
        <div class="main-row">
          <div class="name-col">
            <div class="name-line">
              <span class="name">{{ source.name }}</span>
              <span class="tag" :class="{ ok: source.status === 'ready', err: source.status === 'error' }">
                {{ STATUS_TEXT[source.status] ?? source.status }}
              </span>
              <span class="tag">{{ source.format === 'lx' ? '洛雪' : 'MusicFree' }}</span>
              <span v-if="source.maxQuality" class="tag accent">
                {{ QUALITY_META[source.maxQuality]?.short ?? source.maxQuality }}
              </span>
            </div>
            <div class="sub-line faint ellipsis">
              <span v-if="source.version">v{{ source.version }}</span>
              <span v-if="source.author"> · {{ source.author }}</span>
              <span v-if="source.platforms.length"> · 平台 {{ source.platforms.length }} 个</span>
              <span v-if="source.stat.success + source.stat.fail > 0">
                · 成功 {{ source.stat.success }} / 失败 {{ source.stat.fail }}
              </span>
            </div>
          </div>

          <div class="platforms">
            <span
              v-for="p in source.platforms.slice(0, 6)"
              :key="p"
              class="tag"
              :title="PLATFORM_META[p]?.name ?? p"
            >
              {{ PLATFORM_META[p]?.short ?? p.toUpperCase() }}
            </span>
            <span v-if="source.platforms.length > 6" class="tag">+{{ source.platforms.length - 6 }}</span>
          </div>

          <div class="ops">
            <button class="ghost small" @click="toggleExpand(source.id)">
              {{ expanded.has(source.id) ? '收起' : '详情' }}
            </button>
            <button
              class="ghost small"
              :title="source.enabled ? '禁用该音源' : '启用该音源'"
              @click="sources.toggle(source.id, !source.enabled)"
            >
              {{ source.enabled ? '停用' : '启用' }}
            </button>
            <button class="ghost small" :disabled="sources.busy" @click="sources.reload(source.id)">
              重载
            </button>
            <button class="ghost small danger" @click="confirmRemove(source)">移除</button>
          </div>
        </div>

        <!-- 展开：能力明细 / 错误 / 日志 -->
        <div v-if="expanded.has(source.id)" class="detail">
          <div v-if="source.error" class="detail-block err-block">
            <div class="detail-title">错误</div>
            <pre class="mono">{{ source.error }}</pre>
          </div>

          <div class="detail-block">
            <div class="detail-title">能力</div>
            <div class="caps">
              <div v-for="cap in source.capabilities" :key="cap.platform" class="cap">
                <span class="tag">{{ PLATFORM_META[cap.platform]?.short ?? cap.platform }}</span>
                <span class="faint">{{ cap.name }}</span>
                <span class="faint mono">actions: {{ cap.actions.join('/') || '—' }}</span>
                <span class="faint mono">
                  音质: {{ cap.qualities.map((q) => QUALITY_META[q]?.short ?? q).join(' ') || '—' }}
                </span>
              </div>
              <div v-if="source.capabilities.length === 0" class="faint">该音源未上报任何能力</div>
            </div>
          </div>

          <div class="detail-block">
            <div class="detail-title">路径</div>
            <div class="mono faint path">{{ source.path }}</div>
          </div>

          <div v-if="source.logs && source.logs.length > 0" class="detail-block">
            <div class="detail-title">脚本输出（尾部）</div>
            <pre class="mono logs">{{ source.logs.slice(-12).join('\n') }}</pre>
          </div>
        </div>
      </div>
    </div>

    <footer v-if="sources.coveredPlatforms.length > 0" class="coverage">
      <span class="faint small-text">当前可用平台：</span>
      <span v-for="p in sources.coveredPlatforms" :key="p.id" class="tag">{{ p.name }}</span>
    </footer>
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

/* ------------------------------ 统计 ------------------------------ */

.stats {
  display: flex;
  gap: 26px;
}

.stat {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.stat .num {
  font-size: 20px;
  font-weight: 600;
  color: var(--text);
}

.stat.danger .num {
  color: var(--danger);
}

.stat .faint {
  font-size: 11.5px;
}

/* ------------------------------ 操作 ------------------------------ */

.actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.filter {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.filter .ghost {
  border-radius: 4px;
}

.filter .ghost.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.url-box {
  display: flex;
  gap: 8px;
}

.url-box input {
  flex: 1;
}

.import-result {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.err-box {
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(212, 87, 76, 0.3);
  background: rgba(212, 87, 76, 0.08);
  color: #e79a92;
  font-size: 12.5px;
}

/* ------------------------------ 列表 ------------------------------ */

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 18px;
}

.item {
  border-bottom: 1px solid var(--line-soft);
}

.item.error {
  background: linear-gradient(90deg, rgba(212, 87, 76, 0.05), transparent 55%);
}

.main-row {
  display: grid;
  grid-template-columns: minmax(240px, 1.6fr) auto auto;
  align-items: center;
  gap: 16px;
  padding: 11px 0;
}

.name-col {
  min-width: 0;
}

.name-line {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.name {
  font-size: 13.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub-line {
  font-size: 11.5px;
  margin-top: 2px;
}

.platforms {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 260px;
}

.ops {
  display: flex;
  gap: 3px;
}

/* ------------------------------ 详情 ------------------------------ */

.detail {
  padding: 4px 0 16px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.detail-title {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.caps {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cap {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11.5px;
  flex-wrap: wrap;
}

.err-block pre {
  margin: 0;
  padding: 10px;
  border-radius: var(--radius-sm);
  background: rgba(212, 87, 76, 0.08);
  border: 1px solid rgba(212, 87, 76, 0.25);
  color: #e79a92;
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 140px;
  overflow: auto;
  user-select: text;
}

.path {
  font-size: 11px;
  word-break: break-all;
  user-select: text;
}

.logs {
  margin: 0;
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  border: 1px solid var(--line);
  font-size: 11px;
  color: var(--text-dim);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  overflow: auto;
  user-select: text;
}

/* ------------------------------ 覆盖 ------------------------------ */

.coverage {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 10px 18px;
  border-top: 1px solid var(--line-soft);
}
</style>
