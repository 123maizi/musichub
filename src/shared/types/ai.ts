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
    hint: '完全离线，不花钱，速度取决于本机'
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
  targetLanguage: '简体中文'
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
