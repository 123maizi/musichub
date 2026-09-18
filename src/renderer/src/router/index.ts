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
