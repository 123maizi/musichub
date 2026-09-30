import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

/**
 * 生产构建开启 esbuild 压缩。
 *
 * electron-vite 2.x 的三个默认配置里都写着 `minify: false`
 * （见 node_modules/electron-vite/dist/chunks/lib-BmEkZIgk.mjs:277 / :382 / :514），
 * 所以 out/ 里一直是**未压缩**的代码：渲染层 604 KiB、主进程 241 KiB、
 * preload 8.7 KiB。同样的源码压一遍体积大致减半 —— 启动时少读盘、少解析，
 * 安装包也更小，功能一行没少。
 *
 * 为什么按 command 而不是 mode 判断：
 *   - `electron-vite dev`（command === 'serve'）：不压缩。主进程/preload 的
 *     变量名、类名、函数名保持原样，DevTools 断点与错误堆栈都好读；
 *   - `electron-vite build`（command === 'build'）：才开启压缩。
 *
 * sourcemap：生产构建显式关掉（Vite 默认也是 false），
 * 产物里不会出现 .map 文件，与 electron-builder.yml 里已有的
 * 「排除所有 .map」规则不冲突；开发态本来就不压缩，也不需要 sourcemap。
 *
 * 为什么不用 keepNames：全仓库没有靠函数名/类名做分支的逻辑
 * （grep 过 Function.prototype.toString / new Function / eval / fn.name 均无命中）；
 * 沙箱注入给第三方音源脚本的是**对象属性名**
 * （EVENT_NAMES / request / on / send / utils / env / version / currentScriptInfo），
 * esbuild 的压缩器不会改属性名。音源脚本本身是运行时从磁盘读入的字符串，
 * 不经过打包，压缩也动不到它。
 */
export default defineConfig(({ command }) => {
  const minify: boolean | 'esbuild' | 'terser' = command === 'build' ? 'esbuild' : false

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: {
          '@main': resolve('src/main'),
          '@shared': resolve('src/shared')
        }
      },
      build: {
        minify,
        sourcemap: false,
        rollupOptions: {
          input: { index: resolve('src/main/index.ts') }
        }
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: {
          '@shared': resolve('src/shared')
        }
      },
      build: {
        minify,
        sourcemap: false,
        rollupOptions: {
          input: { index: resolve('src/preload/index.ts') }
        }
      }
    },
    renderer: {
      root: resolve('src/renderer'),
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@shared': resolve('src/shared')
        }
      },
      plugins: [vue()],
      build: {
        minify,
        sourcemap: false,
        rollupOptions: {
          input: { index: resolve('src/renderer/index.html') }
        }
      }
    }
  }
})
