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
    models?: ModelItem[]
    default_model?: string
    [key: string]: unknown
}

/** 获取应用配置(模型列表等) */
export async function fetchAppConfig(): Promise<AppConfig> {
    return apiFetch<AppConfig>('/api/config')
}
