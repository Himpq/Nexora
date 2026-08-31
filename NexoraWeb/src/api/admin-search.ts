/**
 * admin-search.ts — 管理员:搜索 API 配置
 *
 * 对应后端路由:
 *   GET  /api/admin/search/config   读取搜索配置
 *   POST /api/admin/search/config   保存搜索配置
 */

import { apiFetch } from './client'

export interface SearchProviderConfig {
    api_key?: string
    api_key_masked?: string
    has_api_key?: boolean
    base_url?: string
    type?: string
    num_results?: number
    contents?: Record<string, unknown>
    timeout?: number
    backend?: string
    region?: string
    safesearch?: string
    timelimit?: string
    fetch_content?: boolean
    [key: string]: unknown
}

export interface SearchConfig {
    active_provider: string
    default_num_results: number
    providers: Record<string, SearchProviderConfig>
    supported_providers: string[]
    [key: string]: unknown
}

interface SearchConfigResponse {
    success: boolean
    message?: string
    active_provider?: string
    default_num_results?: number
    providers?: Record<string, SearchProviderConfig>
    supported_providers?: string[]
}

/** 读取搜索配置 */
export async function fetchSearchConfig(): Promise<SearchConfig> {
    const data = await apiFetch<SearchConfigResponse>('/api/admin/search/config')

    if (!data.success) {
        throw new Error(data.message || '加载搜索配置失败')
    }

    return {
        active_provider: String(data.active_provider || 'duckduckgo'),
        default_num_results: Number(data.default_num_results || 8),
        providers: (data.providers as Record<string, SearchProviderConfig>) || {},
        supported_providers: (data.supported_providers as string[]) || ['exa', 'duckduckgo'],
    }
}

/** 保存搜索配置 */
export async function saveSearchConfig(options: {
    active_provider?: string
    default_num_results?: number
    providers?: Record<string, Record<string, unknown>>
    exa?: Record<string, unknown>
    duckduckgo?: Record<string, unknown>
}): Promise<SearchConfig> {
    const payload: Record<string, unknown> = {}

    if (options.active_provider !== undefined) {
        payload.active_provider = options.active_provider
    }

    if (options.default_num_results !== undefined) {
        payload.default_num_results = options.default_num_results
    }

    if (options.providers !== undefined) {
        payload.providers = options.providers
    } else {
        // 兼容扁平传入
        if (options.exa) {
            payload.providers = { ...(payload.providers as Record<string, unknown> || {}), exa: options.exa }
        }

        if (options.duckduckgo) {
            payload.providers = { ...(payload.providers as Record<string, unknown> || {}), duckduckgo: options.duckduckgo }
        }
    }

    const data = await apiFetch<SearchConfigResponse>('/api/admin/search/config', {
        method: 'POST',
        body: JSON.stringify(payload),
    })

    if (!data.success) {
        throw new Error(data.message || '保存搜索配置失败')
    }

    return {
        active_provider: String(data.active_provider || 'duckduckgo'),
        default_num_results: Number(data.default_num_results || 8),
        providers: (data.providers as Record<string, SearchProviderConfig>) || {},
        supported_providers: (data.supported_providers as string[]) || ['exa', 'duckduckgo'],
    }
}
