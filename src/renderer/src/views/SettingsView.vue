<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AppInfo } from '@shared/types/ipc'
import { AI_PRESETS, type AiConfig, type AiTestResult } from '@shared/types/ai'
import { QUALITY_META, QUALITY_ORDER } from '@shared/constants'
import DownloadFormatPicker from '../components/DownloadFormatPicker.vue'
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

/**
 * 数字输入框的 value 统一转成「与 step 对齐的字符串」。
 *
 * 为什么不直接绑数字：Vue 比较 `el.value !== newValue` 时，读回来的 el.value
 * 是**字符串**，绑数字就永远不等 → 每次重渲染都写一次 `el.value`；
 * 而写 number 输入框的 value 会让浏览器重排它内部的影子树 = **一次布局**。
 * 更隐蔽的是 range/number 还会按 step 对齐（step=0.1 时 14.8234 → 14.8），
 * 下一次比对又不等，于是每次渲染都稳定多出一次布局。
 *
 * 设置页没有高频更新，所以这不是会掉帧的急症；但同一个坑没必要留着 ——
 * 统一在这里一次对齐，顺便保证界面上显示的值与真正落盘的值一致。
 */
function numStr(value: number | undefined, fallback: number, step = 1): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const decimals = step < 1 ? (String(step).split('.')[1] ?? '').length : 0
  const factor = 10 ** decimals
  return String(Math.round(n * factor) / factor)
}

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
    <!--
      保存反馈注入顶栏右侧：标题归外壳，状态提示归顶栏 ——
      以前它跟标题挤在同一个 header 里，现在两者各归其位。
    -->
    <Teleport to="#page-actions">
      <Transition name="xfade">
        <span v-if="saved" class="tag ok">已保存</span>
      </Transition>
    </Teleport>

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

        <Transition name="rise">
          <div v-if="aiTestResult" class="ai-result" :class="aiTestResult.ok ? 'ok' : 'err'">
            <template v-if="aiTestResult.ok">
              连接正常<span v-if="aiTestResult.cost">（{{ aiTestResult.cost }}ms）</span>
              <span v-if="aiModels.length"> · 取到 {{ aiModels.length }} 个可用模型</span>
            </template>
            <template v-else>{{ aiTestResult.error }}</template>
          </div>
        </Transition>

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
              :value="numStr(aiCfg?.keepAliveMinutes, 30, 5)"
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
              :value="numStr(aiCfg?.maxTokens, 1500, 100)"
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
              :value="numStr(aiCfg?.temperature, 0.3, 0.1)"
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
              :value="numStr(aiCfg?.timeoutMs ? aiCfg.timeoutMs / 1000 : 60, 60, 1)"
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
          <label>默认下载格式</label>
          <div class="control col gap-4">
            <DownloadFormatPicker
              :model-value="config?.preferQuality"
              :disabled="!config"
              @update:model-value="update({ preferQuality: $event })"
            />
            <span class="faint note">
              搜索页点 ↓ 就按这个格式下；音源给不了这么高时自动降到下一档，并标出「已降级」。
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
              :value="numStr(config?.concurrency, 2, 1)"
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
              :value="numStr(config?.retry, 2, 1)"
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
/*
 * 设置页样式 —— 全部取值来自 token 层，本文件不出现任何手写颜色 / 字号 / 时长。
 *
 * 分区语言：碑刻衬线小标题 + 通栏 1px 刻线 + 大留白；零阴影、零圆角。
 * 左右留白由外壳 .page 统一负责（40px），所以这里**不写任何水平 padding**。
 */
.view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 预留滚动条槽位：内容不会因为滚动条出现/消失而横向跳一下 */
  scrollbar-gutter: stable;
  display: flex;
  flex-direction: column;
  gap: var(--sp-7);
  max-width: 880px;
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

/*
 * 刻线分区：标题在左，右侧由 1px 刻线补满通栏。
 * 这是「分柱」语言在分区上的用法 —— 不用卡片、不用底色、不用阴影，
 * 层次全靠这条线和上下留白。
 */
.group-title {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  font-family: var(--font-display);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--ls-display);
  text-transform: uppercase;
  color: var(--ink);
}

.group-title::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--hairline);
}

/* 标题里的小徽章不许被刻线挤扁 */
.group-title :deep(.tag) {
  flex: none;
}

.field {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: var(--sp-4);
  align-items: start;
}

/* 8px = 输入框内边距，让标签首行与控件里的文字对齐 */
.field > label {
  padding-top: var(--sp-2);
}

.control {
  min-width: 0;
}

.wrap {
  flex-wrap: wrap;
}

.note {
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
  color: var(--ink-subtle);
}

.indent {
  margin-top: var(--sp-1);
  grid-column: 1;
}

input[readonly] {
  color: var(--ink-muted);
  background: var(--surface-3);
}

.num-input {
  width: 76px;
}

.hints {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
}

.hint {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: var(--fs-xs);
  color: var(--ink-subtle);
}

/*
 * 模板变量 chip。
 * 注意：青铜色**不能**出现在 surface-3/4 上（4.32:1，不到 AA），
 * 所以这里用 --ink 文字 + surface-2 底 + hairline 边，而不是强调色。
 */
.hint code {
  color: var(--ink);
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  padding: 0 var(--sp-1);
  border-radius: var(--r-ctl);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
}

.preview {
  font-size: var(--fs-xs);
}

/*
 * 复选框：WCAG 2.5.8 要求可点区域至少 24×24。
 *
 * 原来 `width/height: 14px` 直接把 input 本体做成了 14×14 —— 审计量到的
 * 6 个「<24px 命中区」就是这 6 个复选框（设置页其余可点元素全部达标）。
 *
 * 修法：input 本体撑到 24×24 当真实命中区，视觉方块用 ::before 自绘成 16px 居中；
 * 勾选态用 ::after 画对勾，**只动 transform / opacity**，不碰任何尺寸。
 * 所有取值都取自已冻结的 token 层，不引入新的颜色 / 圆角 / 时长档位。
 */
.check {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  min-height: 24px;
  cursor: pointer;
  color: var(--ink);
}

.check input {
  appearance: none;
  -webkit-appearance: none;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
}

/* 视觉方块：16px，居中在 24px 命中区里 */
.check input::before {
  content: '';
  grid-area: 1 / 1;
  width: 16px;
  height: 16px;
  border-radius: var(--r-ctl);
  border: 1px solid var(--hairline);
  background: var(--surface-2);
  transition:
    background-color var(--dur-1) var(--ease-out),
    border-color var(--dur-1) var(--ease-out);
}

.check input:checked::before {
  background: var(--accent);
  border-color: var(--accent);
}

/* 对勾：只用 rotate + scale + opacity，不碰尺寸 */
.check input::after {
  content: '';
  grid-area: 1 / 1;
  width: 9px;
  height: 5px;
  margin-top: -2px;
  border-left: 2px solid var(--on-accent);
  border-bottom: 2px solid var(--on-accent);
  transform: rotate(-45deg) scale(0.4);
  opacity: 0;
  transition:
    transform var(--dur-1) var(--ease-out),
    opacity var(--dur-1) var(--ease-out);
}

.check input:checked::after {
  transform: rotate(-45deg) scale(1);
  opacity: 1;
}

.check input:disabled {
  cursor: not-allowed;
}

.check input:disabled::before {
  opacity: 0.4;
}

/* ------------------------------ AI 测试结果 ------------------------------ */

/*
 * 结果条：成对语义 token（--ok-soft / --ok-line / --ok-text）。
 * 零阴影；圆角走 --r-ctl（新契约下 = 2px）。原先手写的
 * rgba(76,168,106,.1) / #8fd3a4 这类值全部换掉 —— 页面里不再有第二处色值。
 */
.ai-result {
  margin: 0 0 var(--sp-1);
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--r-ctl);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
}

.ai-result.ok {
  background: var(--ok-soft);
  border: 1px solid var(--ok-line);
  color: var(--ok-text);
}

.ai-result.err {
  background: var(--danger-soft);
  border: 1px solid var(--danger-line);
  color: var(--danger-text);
}

/* ------------------------------ 关于 ------------------------------ */

.info-grid {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: var(--sp-1) var(--sp-4);
  font-size: var(--fs-xs);
  align-items: baseline;
}

.selectable {
  user-select: text;
  word-break: break-all;
  color: var(--ink-muted);
}

/*
 * 免责声明不做卡片（零圆角零阴影），改成左侧 2px 刻线 + 缩进 ——
 * 「引用 / 旁注」的古典标记，与外壳导航当前项的竖线同源。
 */
.disclaimer {
  margin-top: var(--sp-1);
  padding-left: var(--sp-4);
  border-left: 2px solid var(--hairline-strong);
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
  color: var(--ink-subtle);
}

.disclaimer strong {
  display: block;
  margin-bottom: var(--sp-1);
  color: var(--ink);
  font-size: var(--fs-sm);
}

.disclaimer p {
  margin: 0 0 var(--sp-1);
}

.disclaimer p:last-child {
  margin-bottom: 0;
}
</style>
