/**
 * 保存下来的歌词翻译
 *
 * 为什么需要单独一层：翻译结果原本只活在内存里，切一首歌再切回来就没了。
 * 而翻译是要花成本的（要么花 AI 的 token，要么花公共接口的额度），
 * 更别提用户可能还手工改过 —— 那更是丢不起。
 *
 * 与 @main/core/lyric/translate-cache 的区别：
 *   · translate-cache 按「歌词内容的哈希」缓存，是给翻译过程用的去重缓存，
 *     用户看不见也控制不了；
 *   · 这一层按「歌曲 id」保存，是用户能感知的「这首歌的译文」，
 *     可以手动编辑、也可以手动删掉重翻。
 *
 * 手工改过的译文会被标记 edited，之后无论 AI 还是公共接口都不会把它覆盖掉。
 */
import { JsonStore } from '../storage/store'
import type { SavedTranslation } from '@shared/types/ai'

/** 最多保留多少首，超出按最后更新时间淘汰 */
const MAX_ENTRIES = 800

interface StoreShape {
  items: Record<string, SavedTranslation>
}

export class SavedTranslationStore {
  private readonly store: JsonStore<StoreShape>

  constructor(store: JsonStore<StoreShape>) {
    this.store = store
  }

  get(songId: string): SavedTranslation | null {
    if (!songId) return null
    return this.store.get().items[songId] ?? null
  }

  save(entry: SavedTranslation): SavedTranslation {
    const items = { ...this.store.get().items, [entry.songId]: entry }

    const keys = Object.keys(items)
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => (items[a].updatedAt ?? 0) - (items[b].updatedAt ?? 0))
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => delete items[k])
    }

    this.store.set({ items })
    return entry
  }

  remove(songId: string): void {
    const items = { ...this.store.get().items }
    delete items[songId]
    this.store.set({ items })
  }

  size(): number {
    return Object.keys(this.store.get().items).length
  }

  flush(): void {
    this.store.flush()
  }
}
