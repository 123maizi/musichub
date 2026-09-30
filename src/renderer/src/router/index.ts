import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * 用 hash 路由：打包后页面通过 file:// 加载，
 * history 模式在 file 协议下会直接 404。
 *
 * meta.title：外壳顶栏显示的页面标题（碑刻衬线大写）。
 * 视图不再自己画大标题 —— 标题属于外壳，视图只保留工具条与操作
 * （操作通过 <Teleport to="#page-actions"> 注入顶栏右侧）。
 */
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/search' },
    {
      path: '/search',
      name: 'search',
      component: () => import('../views/SearchView.vue'),
      meta: { title: '搜索' }
    },
    {
      path: '/downloads',
      name: 'downloads',
      component: () => import('../views/DownloadView.vue'),
      meta: { title: '下载' }
    },
    {
      path: '/artist',
      name: 'artist',
      component: () => import('../views/ArtistView.vue'),
      meta: { title: '歌手' }
    },
    {
      path: '/album',
      name: 'album',
      component: () => import('../views/AlbumView.vue'),
      meta: { title: '专辑' }
    },
    {
      path: '/now-playing',
      name: 'now-playing',
      component: () => import('../views/NowPlayingView.vue'),
      meta: { title: '正在播放' }
    },
    {
      path: '/library',
      name: 'library',
      component: () => import('../views/LibraryView.vue'),
      meta: { title: '我的音乐' }
    },
    {
      path: '/sources',
      name: 'sources',
      component: () => import('../views/SourceView.vue'),
      meta: { title: '音源' }
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
      meta: { title: '设置' }
    }
  ]
})
