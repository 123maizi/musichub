<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import PlayerBar from './components/PlayerBar.vue'
import { useSourceStore } from './stores/sources'
import { useDownloadStore } from './stores/downloads'

const route = useRoute()
const router = useRouter()
const sources = useSourceStore()
const downloads = useDownloadStore()

const navItems = [
  { name: 'search', path: '/search', label: '搜索', hint: '搜歌 · 试听 · 下载' },
  { name: 'downloads', path: '/downloads', label: '下载', hint: '任务 · 文件' },
  { name: 'sources', path: '/sources', label: '音源', hint: '导入 · 启停 · 诊断' },
  { name: 'settings', path: '/settings', label: '设置', hint: '播放 · 下载偏好' }
]

let offSource: (() => void) | null = null
let offDownload: (() => void) | null = null

onMounted(async () => {
  await sources.refresh()
  await downloads.loadConfig()
  await downloads.refresh()
  offSource = sources.bind()
  offDownload = downloads.bind()
})

onUnmounted(() => {
  offSource?.()
  offDownload?.()
})

function go(path: string): void {
  void router.push(path)
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">MH</span>
        <div class="brand-text">
          <strong>MusicHub</strong>
          <span class="faint">多音源聚合</span>
        </div>
      </div>

      <nav class="nav">
        <button
          v-for="item in navItems"
          :key="item.name"
          class="nav-item"
          :class="{ active: route.name === item.name }"
          @click="go(item.path)"
        >
          <span class="nav-label">{{ item.label }}</span>
          <span class="nav-hint">{{ item.hint }}</span>
        </button>
      </nav>

      <div class="side-stat">
        <div class="stat-row">
          <span class="faint">可用音源</span>
          <span class="mono">{{ sources.readySources.length }}</span>
        </div>
        <div class="stat-row">
          <span class="faint">支持无损</span>
          <span class="mono">{{ sources.losslessCount }}</span>
        </div>
        <div class="stat-row">
          <span class="faint">覆盖平台</span>
          <span class="mono">{{ sources.coveredPlatforms.length }}</span>
        </div>
        <div v-if="downloads.activeTasks.length > 0" class="stat-row">
          <span class="faint">下载中</span>
          <span class="mono accent-text">{{ downloads.activeTasks.length }}</span>
        </div>
      </div>
    </aside>

    <main class="main">
      <router-view />
    </main>
  </div>

  <PlayerBar />
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: 208px 1fr;
  height: calc(100vh - 78px);
}

/* ------------------------------ 侧栏 ------------------------------ */

.sidebar {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line);
  background: var(--bg-panel);
  padding: 18px 12px 12px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px 18px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--line-soft);
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--accent);
  color: #1a1408;
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 700;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.brand-text strong {
  font-size: 14px;
  letter-spacing: -0.01em;
}

.brand-text .faint {
  font-size: 11px;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 12px;
}

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 9px 10px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  text-align: left;
  color: var(--text-dim);
  transition: background 0.12s, color 0.12s;
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.nav-label {
  font-size: 13px;
  font-weight: 600;
}

.nav-hint {
  font-size: 11px;
  color: var(--text-faint);
}

.nav-item.active .nav-hint {
  color: rgba(212, 162, 76, 0.7);
}

.side-stat {
  margin-top: auto;
  padding: 12px 10px 4px;
  border-top: 1px solid var(--line-soft);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}

.accent-text {
  color: var(--accent);
}

/* ------------------------------ 主区 ------------------------------ */

.main {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
</style>
