/**
 * 验证 electron.vite.config.ts 的分支：生产构建压缩、开发态不压缩。
 * 直接调 electron-vite 的 resolveConfig（不启动 dev server），把两个分支的 minify 值打出来。
 */
import { resolveConfig } from 'electron-vite'

const out = {}
for (const [label, command, mode] of [
  ['build（生产构建）', 'build', 'production'],
  ['serve（electron-vite dev）', 'serve', 'development']
]) {
  const r = await resolveConfig({ configFile: 'electron.vite.config.ts' }, command, mode)
  out[label] = {
    main: r.config?.main?.build?.minify ?? null,
    preload: r.config?.preload?.build?.minify ?? null,
    renderer: r.config?.renderer?.build?.minify ?? null,
    sourcemap: {
      main: r.config?.main?.build?.sourcemap ?? null,
      preload: r.config?.preload?.build?.sourcemap ?? null,
      renderer: r.config?.renderer?.build?.sourcemap ?? null
    }
  }
}
console.log(JSON.stringify(out, null, 2))
