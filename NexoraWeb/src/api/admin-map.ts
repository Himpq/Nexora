/**
 * admin-map.ts — 管理员:地图 API 配置
 *
 * 对应后端路由:
 *   GET /api/admin/map/provider   读取地图 provider 配置
 */

import { apiFetch } from './client'

export interface MapProviderConfig {
    provider?: string
    provider_ready?: boolean
    providers?: Record<string, Record<string, unknown>>
    config_errors?: string[]
    [key: string]: unknown
}

interface MapProviderResponse {
    success: boolean
    map_provider?: MapProviderConfig
}

/** 读取地图 provider 配置 */
export async function fetchMapProviderConfig(): Promise<MapProviderConfig | null> {
    const data = await apiFetch<MapProviderResponse>('/api/admin/map/provider')

    return data.map_provider || null
}
