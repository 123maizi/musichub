<script setup lang="ts">
/**
 * 「加入歌单」弹层。
 *
 * 后端（LibraryService.playlist → addSongs）和 store（addSongsToPlaylist）
 * 从一开始就支持往歌单里塞歌，但整个界面没有任何入口 ——
 * 歌单建出来只能是个空壳，"从歌单移除"倒是先有了。
 * 这个弹层补上缺的那一环：任意列表、底部播放条、大播放页点一下「加入歌单」，
 * 选一个已有歌单，或者当场新建一个再塞进去。
 *
 * 为什么用 Teleport + fixed 定位而不是就地绝对定位：
 * 歌曲表活在 overflow 滚动容器里，就地弹出的面板会被容器裁掉，
 * 列表一长就只剩半截。挂到 body 上、位置由触发按钮的 rect 算出来最稳。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Song } from '@shared/types/music'
import type { Playlist } from '@shared/types/library'
import { useLibraryStore } from '../stores/library'
import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{
    songs: Song[]
    /** 触发按钮：用它的位置把面板贴过去；没给就贴在窗口右下角 */
    anchor?: HTMLElement | null
  }>(),
  { anchor: null }
)

const emit = defineEmits<{
  close: []
  /** 加入成功后回抛，父级想弹 toast 就用它 */
  added: [playlist: string, count: number]
}>()

const library = useLibraryStore()

const PANEL_WIDTH = 252
const GAP = 6
/** 触发按钮下方留不出这么多高度就翻到上面去（面板最高约 300px） */
const MIN_SPACE_BELOW = 308

const pos = ref<Record<string, string>>({ left: '12px', top: '12px' })
const newName = ref('')
const done = ref<{ name: string; count: number } | null>(null)
const busy = ref(false)
const inputEl = ref<HTMLInputElement | null>(null)

const count = computed(() => props.songs.length)

const title = computed(() => (count.value > 1 ? `${count.value} 首歌加入歌单` : '加入歌单'))

/** 最近动过的排前面，刚新建的不用翻到列表底 */
const ordered = computed(() => [...library.playlists].sort((a, b) => b.updatedAt - a.updatedAt))

/** 已经有几首在这个歌单里 —— 全都在就直接标出来，省得反复点 */
function insideCount(p: Playlist): number {
  const ids = new Set(p.songs.map((s) => s.id))
  return props.songs.filter((s) => ids.has(s.id)).length
}

function place(): void {
  const rect = props.anchor?.getBoundingClientRect()
  if (!rect) {
    pos.value = { left: `${window.innerWidth - PANEL_WIDTH - 18}px`, bottom: '96px' }
    return
  }
  const left = Math.min(Math.max(8, rect.right - PANEL_WIDTH), window.innerWidth - PANEL_WIDTH - 8)
  pos.value =
    window.innerHeight - rect.bottom < MIN_SPACE_BELOW
      ? { left: `${left}px`, bottom: `${Math.round(window.innerHeight - rect.top + GAP)}px` }
      : { left: `${left}px`, top: `${Math.round(rect.bottom + GAP)}px` }
}

/** 先在原地给个明确回执，再收起面板 —— 免得点完不知道成没成 */
function flash(name: string, n: number): void {
  done.value = { name, count: n }
  emit('added', name, n)
  window.setTimeout(() => emit('close'), 620)
}

async function addTo(playlist: Playlist): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await library.addSongsToPlaylist(playlist.id, props.songs)
    flash(playlist.name, count.value)
  } finally {
    busy.value = false
  }
}

async function createAndAdd(): Promise<void> {
  const name = newName.value.trim()
  if (!name || busy.value) return
  busy.value = true
  try {
    // store 只回整份快照，新建之后靠 id 差集认出刚建的那一个
    const before = new Set(library.playlists.map((p) => p.id))
    await library.createPlaylist(name)
    const created = library.playlists.find((p) => !before.has(p.id))
    if (created) await library.addSongsToPlaylist(created.id, props.songs)
    newName.value = ''
    flash(created?.name ?? name, count.value)
  } finally {
    busy.value = false
  }
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(async () => {
  place()
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', place)
  // 直接进搜索页就点按钮时，歌单可能一次都没加载过
  if (library.playlists.length === 0) await library.refresh()
  await nextTick()
  inputEl.value?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', place)
})
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @click="emit('close')" @contextmenu.prevent></div>

    <div class="panel" :style="pos" role="dialog" aria-label="加入歌单">
      <div class="head">
        <span class="ttl ellipsis">{{ title }}</span>
        <button class="ghost tiny" title="关闭" @click="emit('close')">
          <AppIcon name="close" :size="11" />
        </button>
      </div>

      <div class="new">
        <input
          ref="inputEl"
          v-model="newName"
          placeholder="新建歌单并加入…"
          spellcheck="false"
          @keyup.enter="createAndAdd"
        />
        <button class="ghost small" :disabled="!newName.trim() || busy" @click="createAndAdd">
          创建
        </button>
      </div>

      <div class="pls">
        <button
          v-for="p in ordered"
          :key="p.id"
          class="pl"
          :class="{ done: done?.name === p.name }"
          :disabled="busy"
          :title="insideCount(p) > 0 ? `「${p.name}」里已有 ${insideCount(p)} 首` : `加入「${p.name}」`"
          @click="addTo(p)"
        >
          <AppIcon name="playlist" :size="13" />
          <span class="nm ellipsis">{{ p.name }}</span>
          <span v-if="insideCount(p) === count" class="in">已在</span>
          <span v-else-if="insideCount(p) > 0" class="in">+{{ count - insideCount(p) }}</span>
          <span class="ct mono">{{ p.songs.length }}</span>
        </button>

        <div v-if="library.playlists.length === 0" class="none faint">
          还没有歌单<br />在上面输入名字，回车即可创建并加入
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
}

.panel {
  position: fixed;
  z-index: 71;
  width: 252px;
  max-height: 300px;
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 12px;
  border-bottom: 1px solid var(--line-soft);
}

.ttl {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: var(--text-dim);
}

.tiny {
  padding: 3px 6px;
  line-height: 1;
}

.new {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line-soft);
}

.new input {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  padding: 5px 9px;
}

.new .small {
  padding: 5px 10px;
  font-size: 12px;
}

.pls {
  overflow-y: auto;
  padding: 6px;
}

.pl {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.pl:hover:not(:disabled) {
  background: var(--bg-hover);
}

/* 刚加入成功的那一行给个绿色的确定态 */
.pl.done {
  color: var(--ok);
}

.nm {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
}

.ct {
  font-size: 11px;
  color: var(--text-faint);
}

.in {
  font-size: 10.5px;
  color: var(--text-faint);
  flex: none;
}

.none {
  padding: 14px 10px;
  font-size: 12px;
  line-height: 1.7;
  text-align: center;
}
</style>
