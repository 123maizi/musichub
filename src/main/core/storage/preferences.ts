/**
 * 界面偏好存储
 *
 * 单独一个文件（ui-prefs.json），不塞进 download-config.json：
 * 前者是「界面看起来怎样」，后者是「下到哪、下多好」。混在一起之后
 * 两边都难演进，也容易在导出/迁移配置时把不相关的东西带走。
 *
 * 写入沿用 JsonStore 的「防抖 + 原子替换」，退出前由主进程统一 dispose() 落盘。
 */
import {
  DEFAULT_UI_PREFERENCES,
  SEARCH_HISTORY_LIMIT,
  SEARCH_HISTORY_MAX_LEN,
  normalizeSearchEmptySource,
  type SearchEmptySource,
  type UiPreferences
} from '@shared/types/preferences'
import { JsonStore } from './store'

export class PreferencesStore {
  private readonly store: JsonStore<UiPreferences>

  constructor(filePath: string) {
    /**
     * 防抖 400ms：设置页改一个开关、搜索历史连记几条，都不必每次都落盘。
     * 注意：JsonStore 的默认值是**浅拷贝**出去的，所以这里绝不原地 push/splice ——
     * 一律用新数组替换，免得把模块级的 DEFAULT_UI_PREFERENCES 改脏。
     */
    this.store = new JsonStore<UiPreferences>(filePath, DEFAULT_UI_PREFERENCES, { debounceMs: 400 })
  }

  /** 当前偏好（已收敛到合法取值，渲染层拿到的一定是可用的） */
  get(): UiPreferences {
    const raw = this.store.get()
    return {
      searchEmptySource: normalizeSearchEmptySource(raw?.searchEmptySource),
      searchHistory: this.normalizeHistory(raw?.searchHistory)
    }
  }

  /** 局部更新；返回更新后的整份偏好 */
  set(patch: Partial<UiPreferences>): UiPreferences {
    const next: UiPreferences = { ...this.get(), ...patch }
    if (patch.searchEmptySource !== undefined) {
      next.searchEmptySource = normalizeSearchEmptySource(patch.searchEmptySource)
    }
    if (patch.searchHistory !== undefined) {
      next.searchHistory = this.normalizeHistory(patch.searchHistory)
    }
    this.store.set(next)
    return next
  }

  /**
   * 记录一次**真实发起**的搜索。
   *
   * 去重规则：忽略首尾空白与大小写（`FLAC` 与 `flac` 视为同一个词），
   * 保留用户最后一次输入的原样写法；最新的排最前；最多 20 条。
   * 空串直接忽略 —— 界面上「点了搜索但没输入」不该留下一条空记录。
   */
  addSearchHistory(keyword: string): string[] {
    const current = this.get().searchHistory
    const word = normalizeKeyword(keyword)
    if (!word) return current
    const key = word.toLowerCase()
    const rest = current.filter((item) => item.toLowerCase() !== key)
    return this.set({ searchHistory: [word, ...rest] }).searchHistory
  }

  /** 删除单条（同样忽略大小写） */
  removeSearchHistory(keyword: string): string[] {
    const key = String(keyword ?? '').trim().toLowerCase()
    if (!key) return this.get().searchHistory
    return this.set({
      searchHistory: this.get().searchHistory.filter((item) => item.toLowerCase() !== key)
    }).searchHistory
  }

  /** 清空全部 */
  clearSearchHistory(): string[] {
    return this.set({ searchHistory: [] }).searchHistory
  }

  /** 退出前落盘（由主进程的退出清理统一调用） */
  dispose(): void {
    this.store.dispose()
  }

  /** 仅供诊断/验证：确保真的写下去了 */
  flush(): void {
    this.store.flush()
  }

  /** 当前是否还有未落盘的防抖写入 */
  get hasPendingWrite(): boolean {
    return this.store.hasPendingWrite
  }

  /* ------------------------------ 内部 ------------------------------ */

  /** 历史列表规范化：只留字符串、去空、限长、去重（忽略大小写）、截断到上限 */
  private normalizeHistory(list: unknown): string[] {
    if (!Array.isArray(list)) return []
    const out: string[] = []
    const seen = new Set<string>()
    for (const item of list) {
      const word = normalizeKeyword(item)
      if (!word) continue
      const key = word.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(word)
      if (out.length >= SEARCH_HISTORY_LIMIT) break
    }
    return out
  }
}

/** 关键词规范化：压掉换行/连续空白、限长 */
function normalizeKeyword(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, SEARCH_HISTORY_MAX_LEN)
}

export type { SearchEmptySource }
