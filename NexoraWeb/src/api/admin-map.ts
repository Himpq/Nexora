/**
 * admin-map.ts — 管理员:地图 API 配置
 *
 * 对应后端路由:
 *   GET  /api/admin/map/provider            读取地图 provider 配置(含可编辑 config)
 *   POST/PUT /api/admin/map/provider        保存 provider 配置 / 切换默认 provider
 */

import { apiFetch } from './client'

/** 地图 provider 编辑字段(对齐原版 admin_map_settings.js providerConfigFields) */
export const MAP_PROVIDER_FIELDS: Record<string, string[]> = {
    baidu: [
        'browser_ak',
        'browser_version',
        'server_ak',
        'server_sk',
        'auth_mode',
        'timeout',
        'coord_type',
        'ret_coordtype',
        'direction_base_url',
        'geocoding_url',
        'place_search_url',
    ],
    tianditu: [
        'tk',
        'browser_tk',
        'server_tk',
        'browser_version',
        'timeout',
        'coord_type',
        'driving_style',
        'transit_linetype',
        'drive_url',
        'transit_url',
        'geocoding_url',
        'place_search_url',
    ],
}

/** 字段中文标签(对齐原版 providerConfigLabels) */
export const MAP_PROVIDER_FIELD_LABELS: Record<string, string> = {
    browser_ak: '前端 AK',
    browser_version: 'JSAPI 版本',
    server_ak: '后端 AK',
    server_sk: '后端 SK',
    auth_mode: '认证模式',
    timeout: '超时秒数',
    coord_type: '坐标系',
    ret_coordtype: '返回坐标系',
    direction_base_url: '路线规划地址',
    geocoding_url: '地理编码地址',
    place_search_url: '地点检索地址',
    tk: '通用 TK',
    browser_tk: '前端 TK',
    server_tk: '后端 TK',
    driving_style: '驾车策略',
    transit_linetype: '公交策略',
    drive_url: '驾车规划地址',
    transit_url: '公交规划地址',
}

/** 全宽字段(URL 类,对齐原版 fullWidthProviderConfigFields) */
export const MAP_PROVIDER_FULL_WIDTH_FIELDS = new Set([
    'direction_base_url',
    'geocoding_url',
    'place_search_url',
    'drive_url',
    'transit_url',
])

export interface MapProviderStatus {
    provider?: string
    ready?: boolean
    missing?: string[]
    auth_mode?: string
    browser_configured?: boolean
    server_configured?: boolean
    coord_type?: string
    browser_version?: string
    /** 管理员模式附带的可编辑配置(对齐原版 status.config) */
    config?: Record<string, unknown>
    [key: string]: unknown
}

export interface MapProviderConfig {
    provider?: string
    provider_ready?: boolean
    providers?: Record<string, MapProviderStatus>
    config_errors?: string[]
    supported_providers?: string[]
    history_policy?: {
        mode?: string
        summary?: string
        baidu_records?: string
        tianditu_records?: string
    }
    [key: string]: unknown
}

interface MapProviderResponse {
    success: boolean
    message?: string
    map_provider?: MapProviderConfig
}

/** 读取地图 provider 配置 */
export async function fetchMapProviderConfig(): Promise<MapProviderConfig | null> {
    const data = await apiFetch<MapProviderResponse>('/api/admin/map/provider')

    return data.map_provider || null
}

/**
 * 保存地图 provider 配置(对齐原版 saveMapProviderSettings)
 * set_default=true 时同时切换全局默认 provider
 */
export async function saveMapProviderConfig(options: {
    provider: string
    config?: Record<string, unknown>
    set_default?: boolean
}): Promise<MapProviderConfig> {
    const data = await apiFetch<MapProviderResponse>('/api/admin/map/provider', {
        method: 'POST',
        body: JSON.stringify(options),
    })

    if (!data.success) {
        throw new Error(data.message || '保存地图配置失败')
    }

    if (!data.map_provider) {
        throw new Error('保存地图配置失败:响应缺少配置')
    }

    return data.map_provider
}
