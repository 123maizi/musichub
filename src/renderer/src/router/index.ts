import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * 用 hash 路由：打包后页面通过 file:// 加载，
 * history 模式在 file 协议下会直接 404。
 */
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/search' },
    {
      path: '/search',
      name: 'search',
      component: () => import('../views/SearchView.vue')
    },
    {
      path: '/downloads',
      name: 'downloads',
      component: () => import('../views/DownloadView.vue')
    },
    {
      path: '/artist',
      name: 'artist',
      component: () => import('../views/ArtistView.vue')
    },
    {
      path: '/album',
      name: 'album',
      component: () => import('../views/AlbumView.vue')
    },
    {
      path: '/now-playing',
      name: 'now-playing',
      component: () => import('../views/NowPlayingView.vue')
    },
    {
      path: '/library',
      name: 'library',
      component: () => import('../views/LibraryView.vue')
    },
    {
      path: '/sources',
      name: 'sources',
      component: () => import('../views/SourceView.vue')
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue')
    }
  ]
})
