<script setup lang="ts">
/**
 * 应用外壳
 *
 * 主题：**大理石与墨 —— 欧洲古典的雕塑感**。
 * 骨架是「分柱 + 刻线」，不是「卡片堆叠」：
 *
 *   ┌────┬─┬───────────────────────────────┐
 *   │图标│刻│ 顶栏 48px（衬线大写标题 + 操作）│
 *   │导航│线├───────────────────────────────┤
 *   │64px│1│ 内容区（左右 40px 留白）        │
 *   └────┴─┴───────────────────────────────┘
 *           播放条 78px（顶部 1px 刻线）
 *
 * 三条接口约定（团队定死，视图按这个改）：
 *  1. 页面标题由外壳渲染，取 `route.meta.title` —— 视图**不要再画自己的大标题**。
 *  2. 视图的页面级操作通过 `<Teleport to="#page-actions">` 注入顶栏右侧，
 *     外壳不需要知道每个页面有什么按钮。
 *  3. 导航默认只有图标，**当前项才展开文字标签**；当前项标记是左侧 2px 青铜竖线。
 */
import { computed, onMounted, onUnmounted } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

import PlayerBar from './components/PlayerBar.vue'
import { useSourceStore } from './stores/sources'
import { useDownloadStore } from './stores/downloads'
import { useLibraryStore } from './stores/library'

const route = useRoute()
const router = useRouter()
const sources = useSourceStore()
const downloads = useDownloadStore()
const library = useLibraryStore()

/**
 * 导航项。
 *
 * 图标内联在这里而不是走 AppIcon：Playbar/列表用的是 AppIcon 的另一套线宽与
 * 视觉密度，而导航柱需要「同一线宽、同一尺寸」的一组；AppIcon 目前也还没有
 * 齿轮这一档（加它会动到共用组件，跨写作用域）。等骨架稳定后可以再收编。
 */
/**
 * 导航项。
 *
 * 图标语义按用户实机反馈调过：
 *   · 「我的」原来是心形 ♡ —— 心形天然读作「收藏这首歌」（动作），而不是
 *     「去我的收藏列表」（去处），改成书签（已保存的集合）。
 *   · 「下载」原来是向下的箭头 ⬇ —— 同样读成「下载这首歌」，改成「箭入托盘」
 *     （下载任务集合），配合常显标签就无歧义了。
 * 图标内联在这里而不是走 AppIcon：导航柱需要「同一线宽、同一尺寸」的一组，
 * 而 AppIcon 目前也没有书签/托盘这几档（加它会动到共用组件，跨写作用域）。
 */
const navItems = [
  {
    name: 'search',
    path: '/search',
    label: '搜索',
    hint: '搜歌 · 试听 · 下载',
    d: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.2-4.2'
  },
  {
    name: 'library',
    path: '/library',
    label: '我的',
    hint: '喜欢 · 历史 · 歌单',
    d: 'M7 4.5h10v15l-5-3.4-5 3.4z'
  },
  {
    name: 'downloads',
    path: '/downloads',
    label: '下载',
    hint: '任务 · 文件',
    d: 'M4.5 14v4.5h15V14M12 4.5v8.5M8.5 9.5L12 13l3.5-3.5'
  },
  {
    name: 'sources',
    path: '/sources',
    label: '音源',
    hint: '导入 · 启停 · 诊断',
    d: 'M4.5 6.5h15M4.5 12h15M4.5 17.5h15'
  },
  {
    name: 'settings',
    path: '/settings',
    label: '设置',
    hint: '播放 · 下载偏好',
    /* 用「推子」而不是齿轮：18px 下齿轮的齿会糊成一团黑块，推子三条线就清楚 */
    d: 'M4 7h5M13 7h7M4 12h9M17 12h3M4 17h3M11 17h9'
  }
]

/** 顶栏标题：来自路由 meta，视图不再自带大标题 */
const pageTitle = computed(() => String(route.meta.title ?? ''))

/** 侧栏底部只留「可用音源」与「下载中」两项计数，其余统计移入各自页面 */
const railStats = computed(() => [
  { label: '音源', value: sources.readySources.length, hint: `可用音源 ${sources.readySources.length} / 无损 ${sources.losslessCount} / 覆盖平台 ${sources.coveredPlatforms.length}` },
  { label: '收藏', value: library.stats.favorites, hint: `我的收藏 ${library.stats.favorites}` },
  { label: '下载', value: downloads.activeTasks.length, hint: `下载中 ${downloads.activeTasks.length}`, accent: downloads.activeTasks.length > 0 }
])

let offSource: (() => void) | null = null
let offDownload: (() => void) | null = null

onMounted(async () => {
  await sources.refresh()
  await downloads.loadConfig()
  await downloads.refresh()
  await library.refresh()
  offSource = sources.bind()
  offDownload = downloads.bind()
})

onUnmounted(() => {
  offSource?.()
  offDownload?.()
})

function go(path: string): void {
  void router.push(path)
}
</script>

<template>
  <div class="shell">
    <!-- 极窄图标导航柱 -->
    <nav class="rail">
      <div class="brand" title="MusicHub · 多音源聚合">MH</div>

      <button
        v-for="item in navItems"
        :key="item.name"
        class="nav-item"
        :class="{ active: route.name === item.name }"
        :title="`${item.label} · ${item.hint}`"
        :aria-label="item.label"
        @click="go(item.path)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path :d="item.d" />
        </svg>
        <span class="nav-label">{{ item.label }}</span>
      </button>

      <div class="rail-spacer"></div>

      <!--
        底部计数：窄柱塞不下原来的四行文案，改成「数字 + 2 字标签 + tooltip」，
        上方压一条刻线与导航分开 —— 不然三行数字会和导航挤成一团、也没有边界感。
      -->
      <div class="rail-stats">
        <div
          v-for="stat in railStats"
          :key="stat.label"
          class="rail-stat"
          :class="{ accent: stat.accent }"
          :title="stat.hint"
        >
          <span class="rail-stat-value">{{ stat.value }}</span>
          <span class="rail-stat-label">{{ stat.label }}</span>
        </div>
      </div>
    </nav>

    <!-- 通高刻线：古典分柱关系，全站唯一的垂直分割 -->
    <div class="column-rule"></div>

    <div class="content">
      <!-- 顶栏：压薄到 48px，标题碑刻衬线大写疏排，右侧是视图操作注入口 -->
      <header class="topbar">
        <h1 class="topbar-title">{{ pageTitle }}</h1>
        <div id="page-actions" class="page-actions"></div>
      </header>

      <!--
        路由过渡：out-in —— 旧的先退、新的再进，两个页面重叠会让人以为界面在抖。
        过渡类 route-* 定义在 styles/motion.css，时长走 --dur-1/--dur-2 token。
      -->
      <main class="page">
        <!--
          ⚠️ 路由**刻意不用 <Transition>** —— 它会因为 rAF 停摆把界面卡死。

          Vue 的 <Transition> 推进离开动画靠「双 requestAnimationFrame」：
          加 leave-from → 下一帧摘掉它、加 leave-to → 属性变化 → 过渡开始 → transitionend。
          窗口被最小化/遮挡时（Windows 遮挡检测会让 document.hidden 变 true），
          rAF **完全停摆**（实测隐藏窗口 600ms 内 0 帧），于是：
            · mode="out-in"：新视图永不进场，界面彻底卡在旧页 —— 用户看到「点导航没反应」
            · 默认模式：旧视图永远退不掉，越点越堆叠（实测残留 2 个、页面文字混在一起）

          试过加 :duration，**没用** —— Vue 的超时逻辑在 nextFrame 之后，rAF 不来轮不到它。

          所以改成：RouterView 裸渲染 + motion.css 给 `.page > *` 加一条纯 CSS 入场动画。
          CSS 动画由浏览器合成器推进，不依赖 JS 的 rAF，**结构上不可能卡死**；
          代价只是没有「旧页淡出」这一半，换来的是「任何情况下点导航都有反应」。
        -->
        <RouterView />
      </main>
    </div>
  </div>

  <PlayerBar />
</template>

<style scoped>
/* 外壳：图标柱 | 1px 刻线 | 内容 */
.shell {
  display: grid;
  grid-template-columns: var(--rail-w) var(--column-rule) 1fr;
  /* 播放条高度走 token：它改高度时只需要动 style.css 一处 */
  height: calc(100vh - var(--playerbar-h));
}

/* ------------------------------ 导航柱 ------------------------------ */

.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  /* 底部留 --sp-5：让底部计数落在 78px 播放条之上的安全区，不被压住 */
  padding: var(--sp-4) 0 var(--sp-5);
  background: var(--surface-1);
}

.brand {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  margin-bottom: var(--sp-5);
  background: var(--ink);
  color: var(--canvas);
  font-family: var(--font-display);
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  letter-spacing: var(--ls-wide);
}

/**
 * 导航项：**标签常显**。
 *
 * 第一版做的是「只有当前项展开标签」，用户实机反馈「左边的收藏和下载按键点击无效」——
 * 路由其实是通的（点了会跳到 #/library、#/downloads），但**只有图标时 ♡ 和 ⬇ 读起来
 * 像「收藏这首歌 / 下载这首歌」的动作按钮**，不像导航去处；再加上那两个页面本来就是空的，
 * 跳过去更像什么都没发生。
 * 常显标签既消歧义，也和 Ins 的左侧导航一致（它本身就是带常显标签的）。
 *
 * 当前项标记用「左侧 2px 青铜竖线 + scaleY 长出来」，不用高亮底块 ——
 * 底块是现代 SaaS 的语言，刻线才是古典的分柱关系；而且 transform 在合成层解决，
 * 切页不会让整列文字横移。
 */
.nav-item {
  position: relative;
  width: 48px;
  min-height: 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  padding: var(--sp-1) 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--ink-subtle);
  cursor: pointer;
  transition:
    color var(--dur-1) var(--ease-out),
    background-color var(--dur-1) var(--ease-out);
}

.nav-item svg {
  width: 18px;
  height: 18px;
  flex: none;
}

.nav-item::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 50%;
  width: 2px;
  height: 20px;
  margin-top: -10px;
  background: var(--accent);
  transform: scaleY(0);
  transform-origin: center;
  transition: transform var(--dur-2) var(--ease-out);
}

.nav-item:hover {
  color: var(--ink);
  background: var(--surface-3);
}

.nav-item.active {
  color: var(--ink);
}

.nav-item.active::before {
  transform: scaleY(1);
}

/* 标签常显：不再有「展开/收起」两态，避免导航项被读成动作按钮（用户实机反馈） */
.nav-label {
  font-size: var(--fs-xs);
  line-height: 1.2;
  letter-spacing: var(--ls-wide);
  white-space: nowrap;
}

/* 当前项：标签跟着变青铜，和左侧刻线一起构成「你在这里」 */
.nav-item.active .nav-label {
  color: var(--accent);
}

.rail-spacer {
  flex: 1;
}

/**
 * 底部计数区。
 *
 * 之前三行数字直接堆在柱子底部，24px 的柱子空间里行距几乎贴死、也看不出
 * 与导航的分界。现在：上方一条刻线划开（古典的「线即分区」），行距用 --sp-3，
 * 字号全部走 --fs-* 档位（原来手写的 10px 是审计里的离网字号）。
 * 柱子底部留 --sp-5，保证它落在 78px 播放条之上的安全区里，不会被压住。
 */
.rail-stats {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  padding-top: var(--sp-4);
  border-top: 1px solid var(--hairline);
}

.rail-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  /* 不给 gap：两行文字靠 line-height 拉开即可，2px 这种手写值会踩到 4px 网格外 */
  line-height: 1.25;
}

.rail-stat-value {
  font-family: var(--font-display);
  font-size: var(--fs-sm);
  color: var(--ink);
}

.rail-stat-label {
  font-size: var(--fs-xs);
  color: var(--ink-subtle);
}

.rail-stat.accent .rail-stat-value {
  color: var(--accent);
}

.column-rule {
  background: var(--hairline);
}

/* ------------------------------ 内容区 ------------------------------ */

.content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--canvas);
}

.topbar {
  flex: none;
  height: var(--topbar-h);
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: 0 var(--page-pad-x);
  border-bottom: 1px solid var(--hairline);
  background: var(--canvas);
}

.topbar-title {
  margin: 0;
  font-size: var(--fs-md);
  /* 碑刻：衬线 + 大写 + 疏排（h1 的通用规则已在 style.css 里给全） */
  letter-spacing: var(--ls-display);
}

/* 视图操作注入口：视图用 <Teleport to="#page-actions"> 往这里塞按钮 */
.page-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* 大留白：内容不贴边，靠刻线与留白分区 */
  padding: var(--sp-5) var(--page-pad-x) var(--sp-6);
  overflow: hidden;
}

.page > :deep(*) {
  min-height: 0;
}
</style>
