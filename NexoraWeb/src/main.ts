/**
 * main.ts — 应用入口
 *
 * 职责:
 *   - 创建 Vue 应用,挂载 Pinia 与 Router
 *   - 设计资产层(原版 CSS)已在 index.html 引入
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

import './styles/tokens.css'
import './styles/nexora-toast.css'
import './styles/modal.css'
import './styles/admin.css'
import './styles/settings.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
