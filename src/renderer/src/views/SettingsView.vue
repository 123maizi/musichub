<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AppInfo } from '@shared/types/ipc'
import { QUALITY_META, QUALITY_ORDER } from '@shared/constants'
import { useDownloadStore } from '../stores/downloads'
import { usePlayerStore } from '../stores/player'
import { useSourceStore } from '../stores/sources'

const downloads = useDownloadStore()
const player = usePlayerStore()
const sources = useSourceStore()

const info = ref<AppInfo | null>(null)
const saved = ref(false)

/** Vue 模板作用域看不到全局 window，显式暴露给模板用 */
const api = window.api

const templateVars = [
  { key: '{name}', desc: '歌曲名' },
  { key: '{singer}', desc: '歌手（多歌手用 / 分隔）' },
  { key: '{album}', desc: '专辑名' },
  { key: '{quality}', desc: '音质标签，如 FLAC / 320K' },
  { key: '{platform}', desc: '平台名，如 QQ音乐' }
]

const config = computed(() => downloads.config)

/** 文件名预览，让用户不用真下载一次就知道模板效果 */
const namePreview = computed(() => {
  const tpl = config.value?.nameTemplate ?? '{singer} - {name}'
  return `${tpl
    .replace(/\{name\}/gi, '晴天')
    .replace(/\{singer\}/gi, '周杰伦')
    .replace(/\{album\}/gi, '叶惠美')
    .replace(/\{quality\}/gi, 'FLAC')
    .replace(/\{platform\}/gi, 'QQ音乐')}.mp3`
})

onMounted(async () => {
  await downloads.loadConfig()
  await sources.refresh()
  info.value = await api.app.info()
})

async function update(patch: Parameters<typeof downloads.setConfig>[0]): Promise<void> {
  await downloads.setConfig(patch)
  saved.value = true
  setTimeout(() => (saved.value = false), 1600)
}
</script>

<template>
  <section class="view">
    <header class="header">
      <h2>设置</h2>
      <Transition name="fade">
        <span v-if="saved" class="tag ok">已保存</span>
      </Transition>
    </header>

    <div class="scroll">
      <!-- ------------------------------ 下载 ------------------------------ -->
      <div class="group">
        <div class="group-title">下载</div>

        <div class="field">
          <label>保存目录</label>
          <div class="control row gap-8">
            <input class="grow mono" :value="config?.dir ?? ''" readonly />
            <button @click="downloads.chooseDir()">选择</button>
            <button class="ghost small" :disabled="!config?.dir" @click="api.download.showInFolder(config!.dir + '\\')">
              打开
            </button>
          </div>
        </div>

        <div class="field">
          <label>文件名模板</label>
          <div class="control col gap-8">
            <input
              class="mono"
              :value="config?.nameTemplate ?? ''"
              @change="update({ nameTemplate: ($event.target as HTMLInputElement).value })"
            />
            <div class="hints">
              <span v-for="v in templateVars" :key="v.key" class="hint">
                <code class="mono">{{ v.key }}</code>
                <span class="faint">{{ v.desc }}</span>
              </span>
            </div>
            <div class="preview faint">
              预览：<span class="mono">{{ namePreview }}</span>
            </div>
          </div>
        </div>

        <div class="field">
          <label>同名文件</label>
          <div class="control">
            <select
              :value="config?.conflict ?? 'rename'"
              @change="update({ conflict: ($event.target as HTMLSelectElement).value as never })"
            >
              <option value="rename">重命名（加序号）</option>
              <option value="overwrite">覆盖</option>
              <option value="skip">跳过</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label>首选音质</label>
          <div class="control col gap-4">
            <select
              :value="config?.preferQuality ?? '320k'"
              @change="update({ preferQuality: ($event.target as HTMLSelectElement).value as never })"
            >
              <option v-for="q in QUALITY_ORDER" :key="q" :value="q">
                {{ QUALITY_META[q]?.name }}（{{ QUALITY_META[q]?.short }}）
              </option>
            </select>
            <span class="faint note">
              下载时会优先按此音质取流；音源不支持时自动降级到更低音质，不会直接失败。
            </span>
          </div>
        </div>

        <div class="field">
          <label>并发下载数</label>
          <div class="control row gap-12">
            <input
              type="number"
              min="1"
              max="6"
              class="num-input"
              :value="config?.concurrency ?? 2"
              @change="update({ concurrency: Number(($event.target as HTMLInputElement).value) })"
            />
            <span class="faint note">同时下载的任务数。调太高容易触发音源限流。</span>
          </div>
        </div>

        <div class="field">
          <label>失败重试次数</label>
          <div class="control row gap-12">
            <input
              type="number"
              min="0"
              max="5"
              class="num-input"
              :value="config?.retry ?? 2"
              @change="update({ retry: Number(($event.target as HTMLInputElement).value) })"
            />
            <span class="faint note">单文件取流或传输失败后的重试上限。</span>
          </div>
        </div>

        <div class="field">
          <label>标签与封面</label>
          <div class="control row gap-16">
            <label class="check">
              <input
                type="checkbox"
                :checked="config?.writeTag ?? true"
                @change="update({ writeTag: ($event.target as HTMLInputElement).checked })"
              />
              <span>写入标题/歌手/专辑</span>
            </label>
            <label class="check">
              <input
                type="checkbox"
                :checked="config?.downloadCover ?? true"
                @change="update({ downloadCover: ($event.target as HTMLInputElement).checked })"
              />
              <span>内嵌封面</span>
            </label>
          </div>
          <span class="faint note indent">
            支持 MP3（ID3v2.3）与 FLAC（Vorbis Comment）；其它格式会跳过标签写入。
          </span>
        </div>
      </div>

      <!-- ------------------------------ 播放 ------------------------------ -->
      <div class="group">
        <div class="group-title">播放</div>

        <div class="field">
          <label>默认播放音质</label>
          <div class="control col gap-4">
            <select
              :value="player.quality"
              @change="player.setQuality(($event.target as HTMLSelectElement).value as never)"
            >
              <option v-for="q in QUALITY_ORDER" :key="q" :value="q">
                {{ QUALITY_META[q]?.name }}（{{ QUALITY_META[q]?.short }}）
              </option>
            </select>
            <span class="faint note">切换后当前歌曲会立即按新音质重新取流。</span>
          </div>
        </div>
      </div>

      <!-- ------------------------------ 音源概览 ------------------------------ -->
      <div class="group">
        <div class="group-title">音源</div>
        <div class="field">
          <label>状态</label>
          <div class="control row gap-8 wrap">
            <span class="tag ok">可用 {{ sources.readySources.length }}</span>
            <span class="tag">总计 {{ sources.list.length }}</span>
            <span v-if="sources.errorSources.length" class="tag err">
              失败 {{ sources.errorSources.length }}
            </span>
            <span class="tag accent">支持无损 {{ sources.losslessCount }}</span>
          </div>
        </div>
        <div class="field">
          <label>操作</label>
          <div class="control row gap-8">
            <button class="ghost small" @click="$router.push('/sources')">管理音源</button>
            <button class="ghost small" @click="api.source.openDir()">打开音源目录</button>
          </div>
        </div>
      </div>

      <!-- ------------------------------ 关于 ------------------------------ -->
      <div class="group">
        <div class="group-title">关于</div>
        <div v-if="info" class="info-grid">
          <span class="faint">版本</span><span class="mono">{{ info.version }}</span>
          <span class="faint">Electron</span><span class="mono">{{ info.electron }}</span>
          <span class="faint">Chromium</span><span class="mono">{{ info.chrome }}</span>
          <span class="faint">Node</span><span class="mono">{{ info.node }}</span>
          <span class="faint">流代理端口</span><span class="mono">127.0.0.1:{{ info.proxyPort }}</span>
          <span class="faint">用户数据</span><span class="mono selectable">{{ info.userDataPath }}</span>
          <span class="faint">音源目录</span><span class="mono selectable">{{ info.sourceDir }}</span>
        </div>

        <div class="disclaimer">
          <strong>使用说明</strong>
          <p>
            本软件本身不存储、不提供任何音乐内容，仅作为播放与下载的聚合工具，
            通过用户自行导入的第三方音源脚本获取播放地址。
            音源脚本来自互联网公开渠道，其可用性、稳定性与合法性由来源方负责。
          </p>
          <p>
            请把下载的内容用于个人学习与试听，尊重版权，勿用于商业传播。
          </p>
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
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px;
  border-bottom: 1px solid var(--line);
}

.header h2 {
  font-size: 17px;
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 26px;
  max-width: 880px;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.group-title {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line-soft);
}

.field {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 16px;
  align-items: start;
}

.field > label {
  padding-top: 7px;
}

.control {
  min-width: 0;
}

.wrap {
  flex-wrap: wrap;
}

.note {
  font-size: 11.5px;
  line-height: 1.5;
}

.indent {
  margin-top: 6px;
  grid-column: 1;
}

input[readonly] {
  color: var(--text-dim);
}

.num-input {
  width: 76px;
}

.hints {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
}

.hint code {
  color: var(--accent);
  background: var(--accent-soft);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
}

.preview {
  font-size: 11.5px;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  color: var(--text);
}

.check input {
  width: 14px;
  height: 14px;
  padding: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

/* ------------------------------ 关于 ------------------------------ */

.info-grid {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 6px 16px;
  font-size: 12px;
  align-items: baseline;
}

.selectable {
  user-select: text;
  word-break: break-all;
  color: var(--text-dim);
}

.disclaimer {
  margin-top: 6px;
  padding: 14px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: var(--bg-panel);
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-dim);
}

.disclaimer strong {
  display: block;
  margin-bottom: 6px;
  color: var(--text);
  font-size: 12.5px;
}

.disclaimer p {
  margin: 0 0 6px;
}

.disclaimer p:last-child {
  margin-bottom: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
