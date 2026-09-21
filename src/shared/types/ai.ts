/**
 * AI 歌词翻译：配置与契约
 *
 * 为什么走「OpenAI 兼容」这一条路：
 * DeepSeek、OpenAI、Kimi、智谱、通义、硅基流动、Ollama 本地……
 * 现在几乎全都提供 `/chat/completions` 这一套接口，请求体也基本一致。
 * 所以只实现一种协议，再让用户选预设或自己填地址，
 * 就能一次性适配一大批服务，而不是给每家写一个适配器。
 */

/** 服务商预设 */
export interface AiPreset {
  id: string
  name: string
  /** 默认接口地址（OpenAI 兼容的 base，不含 /chat/completions） */
  baseUrl: string
  /**
   * 默认模型名。
   * 只作为初值 —— 模型名换代很快（DeepSeek 就已经把 deepseek-chat
   * 换成了 deepseek-flash），所以界面上允许改，也支持从接口拉取真实列表。
   */
  model: string
  /** 是否不需要 API Key（本地 Ollama） */
  noKey?: boolean
  /**
   * 是否默认关闭「思考链」。
   *
   * 本地推理模型（qwen3 这类）默认会先写一大段思维链再回答 ——
   * 实测把 6 行歌词硬生生生成成 16000 多 token，上下文直接撑爆。
   * 本地预设默认关掉它。
   */
  disableThinking?: boolean
  hint?: string
}

/**
 * 预设表。
 * 模型名仅作初值，实际以「获取模型列表」拉回来的为准。
 */
export const AI_PRESETS: AiPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    hint: '中文歌词翻得准，价格便宜'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '需要能直连 api.openai.com'
  },
  {
    id: 'moonshot',
    name: 'Kimi / Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    hint: '国内直连，长歌词友好'
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    hint: '有免费额度'
  },
  {
    id: 'dashscope',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    hint: '阿里云百炼'
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    hint: '聚合多家开源模型，有免费额度'
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    noKey: true,
    disableThinking: true,
    hint: '完全离线，不花钱；填本地已导入的模型名即可'
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    model: '',
    hint: '任何兼容 /chat/completions 的服务'
  }
]

/** AI 翻译配置 */
export interface AiConfig {
  /** 是否启用 AI 翻译（关掉就走内置的公共接口） */
  enabled: boolean
  /** 预设 id，仅用于界面回显；实际请求只看 baseUrl / model */
  preset: string
  baseUrl: string
  model: string
  /**
   * API Key。
   * 落盘时会用系统凭据加密（见 main 侧的 safeStorage），
   * 只有在本机且同一用户下才能解回明文。
   */
  apiKey: string
  /** 采样温度，越低越稳定 */
  temperature: number
  /** 单次请求超时（毫秒） */
  timeoutMs: number
  /** AI 失败时是否回落到内置公共接口 */
  fallbackToPublic: boolean
  /** 自定义提示词里的目标语言描述，默认「简体中文」 */
  targetLanguage: string
  /**
   * 关闭思考链。
   * 本地推理模型必开 —— 否则它会先写几千 token 的思维链，慢且容易撑爆上下文。
   */
  disableThinking: boolean
  /**
   * 深度思考翻译。
   *
   * 关（默认）：以速度为先 —— 关掉思考链、token 上限收紧，一秒出结果。
   * 开：允许模型先推理再翻译，译文更准，但慢好几倍。
   * 两者互斥：深度思考开着时，关闭思考链这一项自动失效。
   */
  deepThinking: boolean
  /**
   * 模型常驻时长（分钟）。
   *
   * 只对本地服务（Ollama / LM Studio）有意义：它们默认空闲几分钟就把模型
   * 从显存卸载，下次翻译要重新加载 2.7GB 权重 —— 实测冷调用 4 秒、
   * 热调用 0.36 秒，差 11 倍。设成 0 表示不常驻。
   */
  keepAliveMinutes: number
  /**
   * 单次回复的 token 上限。
   * 这是安全阀：模型一旦「不会停」，没有上限就会一直生成到把上下文撑爆
   * （实测跑满 4 分 43 秒后报错）。歌词翻译几百 token 足够。
   */
  maxTokens: number
  /**
   * 要求模型输出的格式：
   *  · auto —— 先按 JSON 来，失败自动改用行式重试一次（推荐）
   *  · json —— 只走 JSON
   *  · lines —— 只走「序号|译文」行式
   * 小模型处理 JSON 转义很吃力（实测 2 次挂 1 次），行式对它们友好得多。
   */
  outputFormat: 'auto' | 'json' | 'lines'
}

/** 默认配置 */
export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  preset: 'deepseek',
  baseUrl: AI_PRESETS[0].baseUrl,
  model: AI_PRESETS[0].model,
  apiKey: '',
  temperature: 0.3,
  timeoutMs: 60000,
  fallbackToPublic: true,
  targetLanguage: '简体中文',
  disableThinking: false,
  deepThinking: false,
  keepAliveMinutes: 30,
  maxTokens: 1500,
  outputFormat: 'auto'
}

/**
 * 保存下来的翻译。
 *
 * 用户翻过一次就该一直留着 —— 切歌回来、重启应用都还在。
 * 手动改过的（edited）尤其不能丢，那是用户自己敲进去的东西。
 */
export interface SavedTranslation {
  songId: string
  /** 译文 LRC */
  tlyric: string
  /** 来自哪里：AI / 内置接口 / 平台自带 / 手工编辑 */
  provider: 'ai' | 'public' | 'official' | 'manual'
  /** AI 的话记下模型名，方便回溯 */
  providerName?: string
  /** 是否被用户手工改过 —— 改过的绝不自动覆盖 */
  edited: boolean
  updatedAt: number
}

/** 连接测试结果 */
export interface AiTestResult {
  ok: boolean
  /** 实际请求的完整地址，方便排查填错的情况 */
  endpoint?: string
  /** 服务端返回的模型列表（部分服务商支持） */
  models?: string[]
  /** 往返耗时（毫秒） */
  cost?: number
  /** 失败原因（已翻译成人话） */
  error?: string
}

/** 翻译时使用的提供方 */
export type TranslateProvider = 'ai' | 'public' | 'official'
