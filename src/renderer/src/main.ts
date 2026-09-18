import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import CoverImage from './components/CoverImage.vue'
import router from './router'
import './style.css'

const app = createApp(App)

/**
 * 全局注册封面组件。
 * 它被播放条、正在播放页、下载页多处使用，全局注册的好处不只是省 import ——
 * 而是「封面加载失败要兜底」这件事再也无法被哪个页面漏掉。
 */
app.component('CoverImage', CoverImage)

app.use(createPinia()).use(router).mount('#app')
