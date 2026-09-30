/**
 * 私有渲染层构建配置（配合 scripts/isolated-instance.ps1 使用）
 *
 * ── 为什么需要它 ─────────────────────────────────────────────────────
 * 四个人共用 F:\MusicHub\out。页面是懒加载的（AlbumView / LibraryView /
 * ArtistView / NowPlayingView 都是 `() => import(...)`），别人一执行构建，
 * 这些 chunk 的文件名哈希就变了、旧文件被 emptyOutDir 删掉。
 * 结果：你还开着的实例一导航就报
 *   "Failed to fetch dynamically imported module: .../AlbumView-XXXX.js"
 * 页面静默不渲染 —— 实测踩过 3 次，全都是假失败（专辑跳转 / 歌单页 / 歌单移除）。
 *
 * ── 绕法 ────────────────────────────────────────────────────────────
 * 1. 用这份配置把渲染层单独构建到**私有目录**（默认 .tmp/perf-out/renderer）
 * 2. 启动时给 ELECTRON_RENDERER_URL 指向私有目录的 index.html
 *    （main 进程 window.ts: `if (is.dev && process.env.ELECTRON_RENDERER_URL) win.loadURL(...)`）
 * 3. 于是：主进程/preload 仍是共享 out 里的最新代码（进程启动时就加载进内存，
 *    之后别人重建不影响你），而渲染层及其懒加载 chunk 全在私有目录里，
 *    别人怎么重建都动不到 → 测试窗口不再受并发构建干扰。
 *
 * 注意：这份配置只用于**验证**。最终验收仍应在共享 out/ 上跑一遍
 * （构建走 node scripts/build-lock.mjs <标签>）。
 *
 * 用法：
 *   $env:PERF_RENDERER_OUT='.tmp/perf-out/renderer'
 *   node node_modules/vite/bin/vite.js build --config scripts/perf-renderer.vite.config.mjs
 */
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'

const outDir = process.env.PERF_RENDERER_OUT
  ? resolve(process.env.PERF_RENDERER_OUT)
  : resolve('.tmp/perf-out/renderer')

export default {
  root: resolve('src/renderer'),
  // file:// 下必须用相对路径，否则资源全部 404
  base: './',
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  plugins: [vue()],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: { index: resolve('src/renderer/index.html') }
    }
  }
}
