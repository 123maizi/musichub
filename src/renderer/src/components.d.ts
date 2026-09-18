/**
 * 全局组件的类型声明
 *
 * CoverImage 在 main.ts 里全局注册，模板无需 import 即可使用；
 * 但 vue-tsc 需要这份声明才知道它存在，否则模板里会报「未知组件」。
 */
import type CoverImage from './components/CoverImage.vue'

declare module 'vue' {
  export interface GlobalComponents {
    CoverImage: typeof CoverImage
  }
}

export {}
