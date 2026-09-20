/**
 * AI 配置的持久化
 *
 * 关键点只有一个：**API Key 不能明文躺在磁盘上**。
 * 用户填进去的是能直接花钱的凭据，明文存等于把钱包摊在桌面上。
 *
 * 所以用 Electron 的 safeStorage —— Windows 上走 DPAPI，
 * 加密密钥绑定当前用户与当前机器，别的用户或把文件拷走都解不开。
 * 系统不支持时（少数 Linux 环境）退回明文，但在界面上会如实标注，
 * 而不是假装加密了。
 */
import { safeStorage } from 'electron'
import type { AiConfig } from '@shared/types/ai'
import { DEFAULT_AI_CONFIG } from '@shared/types/ai'
import type { JsonStore } from './store'

/** 磁盘上的形态：apiKey 换成密文 */
export interface StoredAiConfig extends Omit<AiConfig, 'apiKey'> {
  /** 加密后的 Key（base64） */
  apiKeyEnc?: string
  /** 未能加密时的明文 Key —— 仅当系统不支持加密时才出现 */
  apiKeyPlain?: string
}

export class AiConfigStore {
  private readonly store: JsonStore<StoredAiConfig>
  /** 明文 Key 只留在内存里，不进配置文件 */
  private apiKey = ''

  constructor(store: JsonStore<StoredAiConfig>) {
    this.store = store
    this.apiKey = this.decryptKey(store.get())
  }

  /** 系统是否支持加密存储 */
  static encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private decryptKey(data: StoredAiConfig): string {
    if (data.apiKeyEnc) {
      try {
        return safeStorage.decryptString(Buffer.from(data.apiKeyEnc, 'base64'))
      } catch {
        // 换了机器或换了用户就解不开 —— 不报错，让用户重填即可
        return ''
      }
    }
    return data.apiKeyPlain ?? ''
  }

  /** 读完整配置（含明文 Key，仅用于主进程内部与界面回显） */
  get(): AiConfig {
    const data = this.store.get()
    return {
      ...DEFAULT_AI_CONFIG,
      ...data,
      apiKey: this.apiKey
    } as AiConfig
  }

  /** 更新配置 */
  set(patch: Partial<AiConfig>): AiConfig {
    if (patch.apiKey !== undefined) this.apiKey = patch.apiKey
    const { apiKey: _ignored, ...rest } = patch

    const next: StoredAiConfig = { ...this.store.get(), ...rest }
    if (AiConfigStore.encryptionAvailable()) {
      try {
        next.apiKeyEnc = safeStorage.encryptString(this.apiKey).toString('base64')
        delete next.apiKeyPlain
      } catch {
        next.apiKeyPlain = this.apiKey
        delete next.apiKeyEnc
      }
    } else {
      next.apiKeyPlain = this.apiKey
      delete next.apiKeyEnc
    }

    this.store.set(next)
    return this.get()
  }

  flush(): void {
    this.store.flush()
  }
}
