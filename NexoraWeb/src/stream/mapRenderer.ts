/**
 * mapRenderer.ts — NexoraMapRenderer 装载器
 *
 * 渲染器本体已收编进前端工程(src/assets/map/,视觉冻结的自洽 IIFE,无导出):
 *   - 副作用:暴露 window.NexoraMapRenderer.renderAll/renderPayload
 *   - 挂载后在 #messagesContainer 上装 MutationObserver 自动扫描
 *     ```nexora-map / ```nexora-map-ref 代码块并渲染为交互地图
 *
 * 本模块职责:登录态下拉取 provider 配置注入 window,再按需动态加载渲染器
 * JS+CSS(经构建切成独立懒加载 chunk,全局仅执行一次);
 * 仅当消息里出现真实地图结果时才调用 ensureNexoraMapRendererAssets。
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

/**
 * 装载地图渲染器:动态 import 懒加载 chunk(模块语义天然幂等,只执行一次)。
 * 渲染器挂载后会在 #messagesContainer 常驻 MutationObserver 持续扫描,
 * 因此必须按需加载;provider 配置由 primeNexoraMapRendererConfig 预先注入。
 */
export function ensureNexoraMapRendererAssets(): Promise<void> {
    if (setupPromise) {
        return setupPromise
    }

    setupPromise = (async () => {
        if (!window.NEXORA_MAP_RENDERER_CONFIG) {
            console.warn('[mapRenderer] 加载渲染器时尚无 provider 配置,场景内嵌 provider 时仍可渲染')
        }

        try {
            await Promise.all([
                import('@/assets/map/nexora_map_renderer.css'),
                import('@/assets/map/nexora_map_renderer.js'),
            ])
        }
        catch {
            console.warn('[mapRenderer] 地图渲染器加载失败,地图结果将以代码块展示')
        }
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
