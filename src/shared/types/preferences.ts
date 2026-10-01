/**
 * 界面偏好契约
 *
 * 与「下载配置」分开：下载配置管的是「下到哪、下多好、怎么命名」，
 * 这一份管的是「界面看起来怎样」。两者落盘文件也不同，互不牵连。
 *
 * 主进程 / 预加载 / 渲染层三方共享这一份定义，避免字段名写歪。
 */

/** 搜索页空态（还没输入关键词时）显示哪一类歌曲 */
export type SearchEmptySource = 'history' | 'favorites' | 'playlist'

export interface UiPreferences {
  /** 搜索页空态显示：历史播放（默认）/ 我的喜欢 / 歌单歌曲 */
  searchEmptySource: SearchEmptySource
  /** 搜索历史：去重、最新在前、最多 SEARCH_HISTORY_LIMIT 条 */
  searchHistory: string[]
}

/** 搜索历史最多保留多少条（硬上限） */
export const SEARCH_HISTORY_LIMIT = 20

/** 下拉里一次最多展示多少条（保留 20 条是为了「删掉一条还能补上」，展示不必那么多） */
export const SEARCH_HISTORY_VISIBLE = 10

/** 关键词长度上限：挡住粘贴进来的一整段文本 */
export const SEARCH_HISTORY_MAX_LEN = 60

export const SEARCH_EMPTY_SOURCE_OPTIONS: {
  value: SearchEmptySource
  label: string
  hint: string
}[] = [
  { value: 'history', label: '历史播放', hint: '最近听过的歌' },
  { value: 'favorites', label: '我的喜欢', hint: '收藏过的歌' },
  { value: 'playlist', label: '歌单歌曲', hint: '自建歌单里的歌' }
]

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  searchEmptySource: 'history',
  searchHistory: []
}

/** 任何来源（老配置文件 / 手改 JSON / 渲染层乱传）的值都要收敛到合法取值 */
export function normalizeSearchEmptySource(value: unknown): SearchEmptySource {
  return value === 'favorites' || value === 'playlist' ? value : 'history'
}
