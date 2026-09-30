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
const panelEl = ref<HTMLElement | null>(null)
/** 面板是否向上展开（决定入场动画从哪一边长出来） */
const above = ref(false)
/**
 * 正在播离场动效。
 *
 * 这个弹层由父级的 v-if 控制，直接 emit('close') 会被立刻摘掉 ——
 * 那就只有入场没有离场（「出现是软的、消失是硬的」）。
 * 所以先挂 .closing 播一段离场，再通知父级卸载。
 */
const closing = ref(false)

/**
 * 关掉面板：先播离场动效，再真正卸载。
 * 时长直接从元素自身的 computed transition-duration 读，避免在 JS 里
 * 再抄一份 token 值 —— 动效刻度只在 style.css 里定义一次。
 */
function requestClose(): void {
  if (closing.value) return
  closing.value = true
  const el = panelEl.value
  const raw = el ? getComputedStyle(el).transitionDuration.split(',')[0].trim() : ''
  const ms = raw ? Number.parseFloat(raw) * (raw.endsWith('ms') ? 1 : 1000) : 0
  window.setTimeout(() => emit('close'), ms > 0 ? Math.min(ms + 24, 400) : 0)
}

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
    above.value = true
    return
  }
  const left = Math.min(Math.max(8, rect.right - PANEL_WIDTH), window.innerWidth - PANEL_WIDTH - 8)
  const toAbove = window.innerHeight - rect.bottom < MIN_SPACE_BELOW
  above.value = toAbove
  pos.value = toAbove
    ? { left: `${left}px`, bottom: `${Math.round(window.innerHeight - rect.top + GAP)}px` }
    : { left: `${left}px`, top: `${Math.round(rect.bottom + GAP)}px` }
}

/** 先在原地给个明确回执，再收起面板 —— 免得点完不知道成没成 */
function flash(name: string, n: number): void {
  done.value = { name, count: n }
  emit('added', name, n)
  window.setTimeout(requestClose, 620)
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
  if (event.key === 'Escape') requestClose()
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
    <!-- 入场/离场都只动 opacity + transform（类定义在 styles/motion.css） -->
    <Transition name="pop" appear>
      <div
        ref="panelEl"
        class="panel"
        :class="{ closing, above }"
        :style="pos"
        role="dialog"
        aria-label="加入歌单"
      >
        <div class="head">
          <span class="ttl ellipsis">{{ title }}</span>
          <button class="ghost tiny" title="关闭" @click="requestClose">
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
    </Transition>

    <!--
      点击空白处关闭。遮罩底色走 --scrim（契约新增），淡入由 motion.css 的 backdrop 类负责；
      它只做两件事：吃掉点击 + 轻微压暗，不参与任何布局动画。
    -->
    <Transition name="backdrop" appear>
      <div class="backdrop" @click="requestClose" @contextmenu.prevent></div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  /* 契约新增的遮罩色；只做压暗，淡入交给 .backdrop-enter-* */
  background: var(--scrim);
}

.panel {
  position: fixed;
  z-index: 71;
  width: 252px;
  max-height: 300px;
  display: flex;
  flex-direction: column;
  background: var(--surface-1);
  border: 1px solid var(--hairline);
  border-radius: var(--r-card);
  /* 零阴影体系：层次靠刻线，不靠浮起 */
  box-shadow: var(--shadow-2);
  overflow: hidden;
  /**
   * 入场/离场只动 opacity + transform。
   * 入场由 motion.css 的 .pop-* 负责（<Transition name="pop" appear>）；
   * 这里的 transition 是为离场服务的：父级用 v-if 控制本组件，直接 emit('close')
   * 会被立刻摘掉、看不到 leave，所以关闭时先挂 .closing 播完再卸载。
   */
  transition:
    opacity var(--dur-2) var(--ease-out),
    transform var(--dur-2) var(--ease-out);
}

/* 面板向上展开时从底边长出来，别从顶边「翻下来」 */
.panel.above {
  transform-origin: bottom center;
}

.panel.closing {
  opacity: 0;
  transform: scale(0.96);
}

.head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--hairline-soft);
}

.ttl {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-xs);
  letter-spacing: var(--ls-wide);
  color: var(--ink-muted);
}

.tiny {
  padding: var(--sp-1) var(--sp-2);
  line-height: 1;
}

.new {
  display: flex;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--hairline-soft);
}

.new input {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  padding: var(--sp-1) var(--sp-2);
}

.new .small {
  padding: var(--sp-1) var(--sp-3);
  font-size: var(--fs-xs);
}

.pls {
  overflow-y: auto;
  padding: var(--sp-2);
}

.pl {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  border: 0;
  border-radius: var(--r-ctl);
  background: transparent;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  /* 只动颜色与 transform（合成层），不动尺寸 */
  transition:
    background-color var(--dur-1) var(--ease-out),
    transform var(--dur-1) var(--ease-out);
}

.pl:hover:not(:disabled) {
  background: var(--surface-3);
  transform: translateX(var(--sp-1));
}

/* 刚加入成功的那一行给个绿色的确定态 */
.pl.done {
  color: var(--ok-text);
}

.nm {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
}

.ct {
  font-size: var(--fs-xs);
  color: var(--ink-subtle);
}

.in {
  font-size: var(--fs-xs);
  color: var(--ink-subtle);
  flex: none;
}

.none {
  padding: var(--sp-4) var(--sp-3);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  text-align: center;
  color: var(--ink-subtle);
}
</style>
