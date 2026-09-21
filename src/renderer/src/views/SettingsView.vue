<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AppInfo } from '@shared/types/ipc'
import { AI_PRESETS, type AiConfig, type AiTestResult } from '@shared/types/ai'
import { QUALITY_META, QUALITY_ORDER } from '@shared/constants'
import { useDownloadStore } from '../stores/downloads'
import { usePlayerStore } from '../stores/player'
import { useSourceStore } from '../stores/sources'
import { cleanIpcError } from '../utils/format'
import { getAiConfig, setAiConfig, testAi } from '../utils/ipc'

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
  aiCfg.value = await getAiConfig()
})

async function update(patch: Parameters<typeof downloads.setConfig>[0]): Promise<void> {
  await downloads.setConfig(patch)
  saved.value = true
  setTimeout(() => (saved.value = false), 1600)
}

/* ------------------------------ AI 歌词翻译 ------------------------------ */

const aiCfg = ref<AiConfig | null>(null)
/** Key 默认遮起来：设置页偶尔会被别人看到 */
const aiKeyVisible = ref(false)
const aiTesting = ref(false)
const aiTestResult = ref<AiTestResult | null>(null)
/** 从服务端拉回来的可用模型；拉不到就退回手填 */
const aiModels = ref<string[]>([])

/** 当前预设的提示文案 */
const aiPresetHint = computed(() => {
  const preset = AI_PRESETS.find((p) => p.id === aiCfg.value?.preset)
  return preset?.hint ?? ''
})

/** 当前预设是否不需要 Key（本地 Ollama） */
const aiNoKeyNeeded = computed(
  () => AI_PRESETS.find((p) => p.id === aiCfg.value?.preset)?.noKey === true
)

/** 算一下能不能用：三个字段缺一个都不行 */
const aiReady = computed(() => {
  const c = aiCfg.value
  if (!c) return false
  return Boolean(c.baseUrl.trim() && c.model.trim() && (c.apiKey.trim() || aiNoKeyNeeded.value))
})

async function updateAi(patch: Partial<AiConfig>): Promise<void> {
  aiCfg.value = await setAiConfig(patch)
  saved.value = true
  setTimeout(() => (saved.value = false), 1600)
}

/**
 * 切换服务商。
 * 顺带把地址与默认模型一起换掉 —— 只换名字不换地址，
 * 会让人以为「选了 DeepSeek 却还在请求 OpenAI」，是最容易踩的坑。
 */
async function applyAiPreset(id: string): Promise<void> {
  const preset = AI_PRESETS.find((p) => p.id === id)
  if (!preset) return
  aiTestResult.value = null
  aiModels.value = []
  await updateAi({ preset: id, baseUrl: preset.baseUrl, model: preset.model })
}

/** 测试连接；成功时顺带把服务端的模型列表填进下拉框 */
async function runAiTest(): Promise<void> {
  if (aiTesting.value) return
  aiTesting.value = true
  try {
    const result = await testAi()
    aiTestResult.value = result
    if (result.models && result.models.length > 0) aiModels.value = result.models
  } catch (err) {
    aiTestResult.value = { ok: false, error: cleanIpcError(err) }
  } finally {
    aiTesting.value = false
  }
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
      <!-- ------------------------------ AI 歌词翻译 ------------------------------ -->
      <div class="group">
        <div class="group-title">
          AI 歌词翻译
          <span v-if="aiCfg?.enabled && aiReady" class="tag accent">已启用</span>
        </div>

        <div class="field">
          <label>启用</label>
          <div class="control col gap-4">
            <label class="check">
              <input
                type="checkbox"
                :checked="aiCfg?.enabled ?? false"
                @change="updateAi({ enabled: ($event.target as HTMLInputElement).checked })"
              />
              <span>用 AI 翻译歌词（关闭则使用内置的免费翻译接口）</span>
            </label>
            <span class="faint note">
              外语歌在播放页点「翻译歌词」时，优先调用你配置的 AI；失败时按下面的开关决定是否回落到内置翻译。
            </span>
          </div>
        </div>

        <div class="field">
          <label>服务商</label>
          <div class="control col gap-4">
            <select
              :value="aiCfg?.preset ?? 'deepseek'"
              @change="applyAiPreset(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="p in AI_PRESETS" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <span v-if="aiPresetHint" class="faint note">{{ aiPresetHint }}</span>
          </div>
        </div>

        <div class="field">
          <label>接口地址</label>
          <div class="control col gap-4">
            <input
              class="mono"
              placeholder="https://api.deepseek.com"
              :value="aiCfg?.baseUrl ?? ''"
              @change="updateAi({ baseUrl: ($event.target as HTMLInputElement).value.trim() })"
            />
            <span class="faint note">
              兼容 OpenAI 的 <code class="mono">/chat/completions</code> 接口。填到
              <code class="mono">/v1</code> 这一层即可，末端的
              <code class="mono">/chat/completions</code> 会自动补上。
            </span>
          </div>
        </div>

        <div class="field">
          <label>API Key</label>
          <div class="control row gap-8">
            <input
              class="grow mono"
              :type="aiKeyVisible ? 'text' : 'password'"
              :placeholder="aiNoKeyNeeded ? '本地部署，可留空' : 'sk-...'"
              :value="aiCfg?.apiKey ?? ''"
              @change="updateAi({ apiKey: ($event.target as HTMLInputElement).value.trim() })"
            />
            <button class="ghost small" @click="aiKeyVisible = !aiKeyVisible">
              {{ aiKeyVisible ? '隐藏' : '显示' }}
            </button>
          </div>
        </div>

        <div class="field">
          <label>模型</label>
          <div class="control col gap-4">
            <div class="row gap-8">
              <select
                v-if="aiModels.length > 0"
                class="grow"
                :value="aiCfg?.model ?? ''"
                @change="updateAi({ model: ($event.target as HTMLSelectElement).value })"
              >
                <option v-for="m in aiModels" :key="m" :value="m">{{ m }}</option>
              </select>
              <input
                v-else
                class="grow mono"
                placeholder="deepseek-flash"
                :value="aiCfg?.model ?? ''"
                @change="updateAi({ model: ($event.target as HTMLInputElement).value.trim() })"
              />
              <button class="ghost small" :disabled="aiTesting" @click="runAiTest">
                {{ aiTesting ? '测试中…' : '测试连接' }}
              </button>
            </div>
            <span class="faint note">
              模型名换代很快，点「测试连接」会顺便拉取服务端的真实模型列表供选择。
            </span>
          </div>
        </div>

        <div v-if="aiTestResult" class="ai-result" :class="aiTestResult.ok ? 'ok' : 'err'">
          <template v-if="aiTestResult.ok">
            连接正常<span v-if="aiTestResult.cost">（{{ aiTestResult.cost }}ms）</span>
            <span v-if="aiModels.length"> · 取到 {{ aiModels.length }} 个可用模型</span>
          </template>
          <template v-else>{{ aiTestResult.error }}</template>
        </div>

        <div class="field">
          <label>失败时回落</label>
          <div class="control col gap-4">
            <label class="check">
              <input
                type="checkbox"
                :checked="aiCfg?.fallbackToPublic ?? true"
                @change="updateAi({ fallbackToPublic: ($event.target as HTMLInputElement).checked })"
              />
              <span>AI 不可用时改用内置免费翻译，并在界面上说明原因</span>
            </label>
          </div>
        </div>

        <div class="field">
          <label>深度思考翻译</label>
          <div class="control col gap-4">
            <label class="check">
              <input
                type="checkbox"
                :checked="aiCfg?.deepThinking ?? false"
                @change="updateAi({ deepThinking: ($event.target as HTMLInputElement).checked })"
              />
              <span>开启：慢一些，但译文更准（允许模型先推理再翻）</span>
            </label>
            <span class="faint note">
              关闭时以速度为先：关掉思考链、token 上限收紧，本地模型一两秒就出结果。
              开启后会留给模型推理的空间，同一首歌可能要十几秒到几十秒，换来更准的译文。
            </span>
          </div>
        </div>

        <div class="field">
          <label>模型常驻</label>
          <div class="control row gap-8">
            <input
              type="number"
              min="0"
              max="1440"
              step="5"
              class="num-input"
              :value="aiCfg?.keepAliveMinutes ?? 30"
              @change="updateAi({ keepAliveMinutes: Math.max(0, Number(($event.target as HTMLInputElement).value)) })"
            />
            <span class="faint">分钟（0 = 不常驻）</span>
          </div>
          <span class="faint note">
            只对本地服务有效。默认空闲几分钟就把模型从显存卸载，下次翻译要重新加载权重 ——
            实测冷启动 4.0 秒、常驻后 0.36 秒，差 11 倍。
          </span>
        </div>

        <div class="field">
          <label>思考链</label>
          <div class="control col gap-4">
            <label class="check">
              <input
                type="checkbox"
                :checked="aiCfg?.disableThinking ?? false"
                :disabled="aiCfg?.deepThinking ?? false"
                @change="updateAi({ disableThinking: ($event.target as HTMLInputElement).checked })"
              />
              <span>关闭思考链（本地推理模型建议勾上）</span>
            </label>
            <span class="faint note">
              本地模型（qwen3 这类）默认会先写一大段思维链再回答 —— 实测 6 行歌词能生成
              1.6 万 token，把上下文撑爆、几分钟才返回。勾上之后 1 秒出结果。
              <template v-if="aiCfg?.deepThinking">（深度思考已开启，这一项暂时不生效）</template>
            </span>
          </div>
        </div>

        <div class="field">
          <label>输出格式</label>
          <div class="control col gap-4">
            <select
              :value="aiCfg?.outputFormat ?? 'auto'"
              @change="updateAi({ outputFormat: ($event.target as HTMLSelectElement).value as never })"
            >
              <option value="auto">自动（先试 JSON，失败改行式重试）</option>
              <option value="json">只用 JSON</option>
              <option value="lines">只用「序号|译文」行式</option>
            </select>
            <span class="faint note">
              小模型处理 JSON 转义很吃力（实测 4B 模型 2 次挂 1 次），行式对它们稳得多。
              选「自动」就不用操心，两种都会替你试。
            </span>
          </div>
        </div>

        <div class="field">
          <label>回复上限</label>
          <div class="control row gap-8">
            <input
              type="number"
              min="200"
              max="8000"
              step="100"
              class="num-input"
              :value="aiCfg?.maxTokens ?? 1500"
              @change="updateAi({ maxTokens: Math.max(200, Number(($event.target as HTMLInputElement).value)) })"
            />
            <span class="faint">token</span>
          </div>
          <span class="faint note">安全阀：模型一旦「不会停」，没上限就会一直生成到报错。</span>
        </div>

        <div class="field">
          <label>温度</label>
          <div class="control row gap-8">
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              class="num-input"
              :value="aiCfg?.temperature ?? 0.3"
              @change="updateAi({ temperature: Math.max(0, Math.min(2, Number(($event.target as HTMLInputElement).value))) })"
            />
            <span class="faint">越低越稳，翻译建议 0 ~ 0.3</span>
          </div>
        </div>

        <div class="field">
          <label>目标语言</label>
          <div class="control col gap-4">
            <input
              :value="aiCfg?.targetLanguage ?? '简体中文'"
              @change="updateAi({ targetLanguage: ($event.target as HTMLInputElement).value.trim() })"
            />
            <span class="faint note">
              填「简体中文」「繁體中文」「English」都可以 —— 这一项会直接写进给模型的提示词。
            </span>
          </div>
        </div>

        <div class="field">
          <label>超时</label>
          <div class="control row gap-8">
            <input
              type="number"
              min="10"
              max="300"
              class="num-input"
              :value="Math.round((aiCfg?.timeoutMs ?? 60000) / 1000)"
              @change="updateAi({ timeoutMs: Math.max(10, Number(($event.target as HTMLInputElement).value)) * 1000 })"
            />
            <span class="faint">秒</span>
          </div>
        </div>

        <div class="field">
          <label>说明</label>
          <div class="control col gap-4">
            <span class="faint note">
              API Key 会用系统凭据加密后再存到本机（Windows 上是 DPAPI，绑定当前用户与当前机器），
              不会明文落盘，也不会随任何请求发往我们之外的第三方 —— 只有你填的这个接口会收到它。
            </span>
          </div>
        </div>
      </div>

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

/* ------------------------------ AI 测试结果 ------------------------------ */

.ai-result {
  margin: 0 0 4px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  line-height: 1.6;
}

.ai-result.ok {
  background: rgba(76, 168, 106, 0.1);
  border: 1px solid rgba(76, 168, 106, 0.35);
  color: #8fd3a4;
}

.ai-result.err {
  background: rgba(212, 87, 76, 0.1);
  border: 1px solid rgba(212, 87, 76, 0.35);
  color: #e79a92;
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
