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
import { initTheme } from '@/ui/theme'

// 设计资产加载顺序:原版 CSS(legacy)在前,GDDP 在后 —— 与收编前入口页的层叠顺序一致
import './styles/legacy.css'
import './styles/gddp.css'
import './styles/scrollbar.css'
import './styles/model-select.css'
import './styles/gddp-layout.css'
import './styles/knowledge-collab.css'
import './styles/workspaces.css'
import './styles/chat-input.css'
import './styles/token-budget-card.css'
import './styles/mail-center.css'
import './styles/tool-chain.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// 主题初始化必须在挂载前:首帧即落 data-theme,避免浅色闪屏
initTheme()

// 全局错误面板:渲染/回调异常直接浮层展示组件栈与原始错误,
// 用于快速定位"切特定会话即崩溃"这类问题(同时保留 console 完整堆栈)
const errorOverlay = document.createElement('pre')

errorOverlay.id = 'nexora-global-error-overlay'
errorOverlay.style.cssText = [
    'display:none',
    'position:fixed',
    'left:0',
    'right:0',
    'bottom:0',
    'max-height:45vh',
    'overflow:auto',
    'z-index:99999',
    'margin:0',
    'padding:12px 16px',
    'background:rgba(153,27,0,0.94)',
    'color:#ffe4e6',
    'font:12px/1.5 Consolas,monospace',
    'white-space:pre-wrap',
    'word-break:break-all',
    'border-top:2px solid #fca5a5',
].join(';')

document.body.appendChild(errorOverlay)

function showGlobalError(kind: string, error: unknown): void {
    const stack = error instanceof Error ? (error.stack || error.message) : String(error)

    console.error(`[nexora:${kind}]`, error)

    errorOverlay.style.display = 'block'
    errorOverlay.textContent += `\n[${new Date().toLocaleTimeString()}][${kind}]\n${stack}\n`
}

app.config.errorHandler = (err, _instance, info) => {
    showGlobalError(`vue ${info}`, err)
}

window.addEventListener('error', (event) => {
    showGlobalError('window.error', event.error || event.message)
})

window.addEventListener('unhandledrejection', (event) => {
    showGlobalError('unhandledrejection', event.reason)
})

// 运行时诊断探针(1Hz):事件循环滞后 + JS 堆采样。
// 滞后≈间隔 → 主线程被同步循环占死;滞后小但堆持续攀升 → 异步无界分配。
const diagSamples: Array<string> = []

let diagLast = performance.now()

window.setInterval(() => {
    const now = performance.now()
    const lag = Math.round(now - diagLast - 1000)

    diagLast = now

    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory

    const heap = mem ? `${Math.round(mem.usedJSHeapSize / 1048576)}MB` : 'n/a'

    const line = `[diag] lag=${lag}ms heap=${heap}`

    diagSamples.push(line)

    if (diagSamples.length > 30) {
        diagSamples.shift()
    }

    if (lag > 300 || diagSamples.length % 5 === 0) {
        console.debug(line)
    }
}, 1000)

app.mount('#app')
