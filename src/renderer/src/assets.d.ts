/**
 * 静态资源的类型声明
 *
 * 为什么需要它：品牌标是 `import brandMark from './assets/brand-mark.png'` 进来的，
 * 而 vue-tsc 不认 `.png` 这种后缀 —— 没有这份声明就会报
 * 「Cannot find module './assets/brand-mark.png'」。
 *
 * 只声明图片：其它后缀（svg 走组件、字体走 CSS）暂时没有 import 需求，
 * 将来真要 import 再加，不要图省事写 `declare module '*'`。
 */
declare module '*.png' {
  const src: string
  export default src
}

declare module '*.jpg' {
  const src: string
  export default src
}

declare module '*.webp' {
  const src: string
  export default src
}
