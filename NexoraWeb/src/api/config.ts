/**
 * config.ts — 全局配置 API
 *
 * 职责:
 *   - 模型目录获取(/api/config)
 */

import { apiFetch } from './client'

export interface ModelItem {
    id: string
    name: string
    provider: string
    status?: string
    context_window?: number
}

export interface AppConfig {
    models?: Array<ModelItem | string>
    default_model?: string
    [key: string]: unknown
}

/** 将普通用户配置中的模型值规范化为选择器统一模型结构。 */
export function normalizeModelItems(models: unknown): ModelItem[] {
    if (!Array.isArray(models)) {
        return []
    }

    return models.flatMap((item) => {
        if (typeof item === 'string') {
            const id = item.trim()

            return id ? [{ id, name: id, provider: '' }] : []
        }

        if (!item || typeof item !== 'object') {
            return []
        }

        const source = item as Partial<ModelItem>
        const id = String(source.id || source.name || '').trim()

        if (!id) {
            return []
        }

        return [{
            id,
            name: String(source.name || id),
            provider: String(source.provider || ''),
            status: source.status ? String(source.status) : undefined,
            context_window: typeof source.context_window === 'number' ? source.context_window : undefined,
        }]
    })
}

/** 获取应用配置(模型列表等) */
export async function fetchAppConfig(): Promise<AppConfig> {
    return apiFetch<AppConfig>('/api/config')
}
