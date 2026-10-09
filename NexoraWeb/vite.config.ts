import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Same Vue source, separate builds and static directories for NexoraWeb and NexoraCode.
// NexoraCode uses the nexoracode mode and proxies its local API to port 27700 in development.
export default defineConfig(({ command, mode }) => {
    const isNexoraCode = mode === 'nexoracode'
    const staticBase = isNexoraCode ? '/static/nexoracode/' : '/static/new/'
    const outputDirectory = isNexoraCode
        ? '../NexoraCode/ui/static/nexoracode'
        : '../ChatDBServer/static/new'
    const apiTarget = isNexoraCode
        ? 'http://127.0.0.1:27700'
        : 'http://127.0.0.1:5000'

    return {
        plugins: [vue()],
        resolve: {
            alias: {
                '@': fileURLToPath(new URL('./src', import.meta.url)),
            },
        },
        base: command === 'build' ? staticBase : '/',
        build: {
            outDir: fileURLToPath(new URL(outputDirectory, import.meta.url)),
            emptyOutDir: true,
            cssCodeSplit: isNexoraCode ? false : undefined,
            rolldownOptions: {
                input: isNexoraCode
                    ? fileURLToPath(new URL('./nexoracode.html', import.meta.url))
                    : undefined,
                output: {
                    ...(isNexoraCode ? {
                        entryFileNames: 'nexoracode.js',
                        assetFileNames: (assetInfo) => assetInfo.name?.endsWith('.css')
                            ? 'nexoracode.css'
                            : 'assets/[name]-[hash][extname]',
                    } : {}),
                    // 保持两个构建产物的第三方依赖分组稳定。
                    manualChunks(id: string): string | undefined {
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
                    target: apiTarget,
                    changeOrigin: true,
                },
                // vendor 资产(字体/图标/高亮主题)由本地 Flask 静态服务提供。
                '/static/vendor': {
                    target: apiTarget,
                    changeOrigin: true,
                },
            },
        },
    }
})
