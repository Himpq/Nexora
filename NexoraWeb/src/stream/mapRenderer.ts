/**
 * mapRenderer.ts — NexoraMapRenderer 装载器
 *
 * 旧版地图渲染器(/static/js/nexora_map_renderer.js)是自治模块:
 *   - 暴露 window.NexoraMapRenderer.renderAll/renderPayload
 *   - 挂载后在 #messagesContainer 上装 MutationObserver 自动扫描
 *     ```nexora-map / ```nexora-map-ref 代码块并渲染为交互地图
 *
 * 本模块职责:登录态下拉取 provider 配置注入 window,再按需加载
 * 渲染器 css 与 ES Module(全局仅一次)。
 */

declare global {
    interface Window {
        NEXORA_MAP_RENDERER_CONFIG?: Record<string, unknown>
        NexoraMapRenderer?: {
            renderAll: (root?: ParentNode) => void
        }
    }
}

let setupPromise: Promise<void> | null = null

/** 注入渲染器样式(幂等) */
function ensureCss(): void {
    if (document.querySelector('link[data-nexora-map-css]')) {
        return
    }

    const link = document.createElement('link')

    link.rel = 'stylesheet'
    link.href = '/static/css/nexora_map_renderer.css'
    link.dataset.nexoraMapCss = '1'

    document.head.appendChild(link)
}

/** 注入渲染器 ES Module(幂等,module onload 即执行完成) */
function ensureScript(): Promise<void> {
    const existing = document.querySelector('script[data-nexora-map-js]')

    if (existing) {
        return Promise.resolve()
    }

    return new Promise((resolve) => {
        const script = document.createElement('script')

        script.type = 'module'
        script.src = '/static/js/nexora_map_renderer.js'
        script.dataset.nexoraMapJs = '1'
        script.onload = () => resolve()
        script.onerror = () => {
            console.warn('[mapRenderer] 地图渲染器加载失败,地图结果将以代码块展示')
            resolve()
        }

        document.head.appendChild(script)
    })
}

/**
 * 装载地图渲染器:注入 css+js(幂等)。
 * 渲染器挂载后会在 #messagesContainer 常驻 MutationObserver 持续扫描,
 * 因此必须按需加载——仅当消息里出现真实地图结果时才调用;
 * 配置由 primeNexoraMapRendererConfig 预先注入。
 */
export function ensureNexoraMapRendererAssets(): Promise<void> {
    if (setupPromise) {
        return setupPromise
    }

    ensureCss()

    setupPromise = (async () => {
        if (!window.NEXORA_MAP_RENDERER_CONFIG) {
            console.warn('[mapRenderer] 加载渲染器时尚无 provider 配置,场景内嵌 provider 时仍可渲染')
        }

        await ensureScript()
    })()

    return setupPromise
}

/** 登录后预取一次 provider 配置并注入 window(轻量,不加载任何脚本) */
export function primeNexoraMapRendererConfig(): void {
    void (async () => {
        try {
            const res = await fetch('/api/map/provider', { credentials: 'include' })
            const data = await res.json().catch(() => ({})) as {
                message?: string
                map_renderer_config?: Record<string, unknown>
            }

            if (data && data.map_renderer_config && typeof data.map_renderer_config === 'object') {
                window.NEXORA_MAP_RENDERER_CONFIG = data.map_renderer_config
            }
            else {
                console.warn('[mapRenderer] 未获取到地图渲染配置', data?.message ?? '')
            }
        } catch (error) {
            console.warn('[mapRenderer] 地图配置拉取失败:', error instanceof Error ? error.message : error)
        }
    })()
}
