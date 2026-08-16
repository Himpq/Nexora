/**
 * admin-system.ts — 管理员:系统设置 API
 *
 * 对应后端路由:
 *   GET /api/admin/system/settings    读取系统总设置
 *   POST /api/admin/system/settings   保存系统总设置
 */

import { apiFetch } from './client'

export interface AdminSystemSettings {
    runtime?: {
        public_base_url?: string
    }
    default_models?: Record<string, string>
    model_options?: Array<{ id: string; name?: string; [key: string]: unknown }>
    services?: {
        rag_database?: { enabled?: boolean; mode?: string; host?: string; port?: number; api_key?: string; service_url?: string }
        nexora_search?: { enabled?: boolean; host?: string; port?: number; api_key?: string; service_url?: string; timeout?: number }
        nexora_learning?: { enabled?: boolean; host?: string; port?: number; api_key?: string; frontend_url?: string; request_timeout?: number }
        nexora_mail?: { enabled?: boolean; host?: string; port?: number; api_key?: string; service_url?: string; timeout?: number; send_timeout?: number; default_group?: string }
    }
}

interface SystemSettingsResponse {
    success: boolean
    settings?: AdminSystemSettings
    message?: string
}

/** 读取系统总设置 */
export async function fetchAdminSystemSettings(): Promise<AdminSystemSettings | null> {
    const data = await apiFetch<SystemSettingsResponse>('/api/admin/system/settings')

    return data.settings || null
}

/** 保存系统总设置(整体覆盖 services 与 runtime) */
export async function saveAdminSystemSettings(settings: AdminSystemSettings): Promise<void> {
    const data = await apiFetch<SystemSettingsResponse>('/api/admin/system/settings', {
        method: 'POST',
        body: JSON.stringify({
            runtime: settings.runtime,
            services: settings.services,
        }),
    })

    if (!data.success) {
        throw new Error(data.message || '保存失败')
    }
}
