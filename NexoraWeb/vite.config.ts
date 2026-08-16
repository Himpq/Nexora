import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 单一前端源工程配置:
// - dev 模式将 /api 代理到本地 ChatDBServer(默认 5000 端口),保证 cookie 同源
// - 构建产物输出到 ChatDBServer/static/new/:
//     * Flask 通过模板引用该目录资源(新页面 /new)
//     * NexoraCode 的 /static 路由同样读到该目录 → 双端自动共享新前端
// - base 在构建时指向 /static/new/,保证资源相对路径在 Flask 下正确
export default defineConfig(({ command }) => ({
    plugins: [vue()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    base: command === 'build' ? '/static/new/' : '/',
    build: {
        outDir: fileURLToPath(new URL('../ChatDBServer/static/new', import.meta.url)),
        emptyOutDir: true,
        rolldownOptions: {
            output: {
                // 按依赖拆分 chunk:naive-ui 及其依赖独立成块,其余第三方进 vendor,减小首屏主包
                manualChunks(id: string): string | undefined {
                    if (/node_modules\/(naive-ui|vooks|vueuc|seemly|css-render|treemate|evtd|date-fns|async-validator|lodash-es|@css-render|@emotion|@juggle|@types)/.test(id)) {
                        return 'naive-ui'
                    }

                    if (id.includes('node_modules')) {
                        return 'vendor'
                    }

                    return undefined
                },
            },
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:5000',
                changeOrigin: true,
            },
        },
    },
}))
