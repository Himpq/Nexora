/**
 * admin-quota.ts — 管理员:额度 API
 *
 * 对应后端路由:
 *   GET /api/admin/quota   服务器统一额度配置与用量概览(含逐模型 model_status_map)
 */

import { apiFetch } from './client'

export interface QuotaModelStatus {
    key: string
    provider: string
    name: string
    tokens: number
    requests: number
    quota_total_tokens: number
    quota_set: boolean
    remaining_tokens: number | null
    overage_tokens: number
    usage_ratio: number | null
    is_exhausted: boolean
    [key: string]: unknown
}

export interface QuotaProvider {
    name: string
    tokens: number
    requests: number
    quota_total_tokens: number
    max_model_overage_tokens: number
    on_exhausted?: string
    models?: QuotaModelStatus[]
    [key: string]: unknown
}

export interface ServerQuota {
    total_tokens: number
    total_requests: number
    enabled?: boolean
    on_exhausted?: string
    provider_overage_actions?: Record<string, string>
    providers?: QuotaProvider[]
    model_status_map: Record<string, QuotaModelStatus>
    model_quota_total_tokens: number
    model_quota_overage_tokens: number
    [key: string]: unknown
}

interface QuotaResponse {
    success: boolean
    quota?: ServerQuota
    message?: string
}

/** 读取额度状态(对齐原版 loadServerQuotaStatus) */
export async function fetchAdminQuota(): Promise<ServerQuota> {
    const data = await apiFetch<QuotaResponse>('/api/admin/quota')

    if (!data.success || !data.quota) {
        throw new Error(data.message || '读取额度失败')
    }

    return data.quota
}

/** 调整单个模型额度(对齐原版 admin_model_quota_update:op=set/adjust) */
export async function updateModelQuota(options: {
    provider: string
    model: string
    op: 'set' | 'adjust'
    total_tokens?: number
    delta_tokens?: number
    reason?: string
}): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/admin/quota/model', {
        method: 'POST',
        body: JSON.stringify(options),
    })

    if (!data.success) {
        throw new Error(data.message || '额度调整失败')
    }
}

/** 保存 Provider 超额策略(对齐原版 saveAdminProviderOverageActionSetting) */
export async function saveProviderOverageAction(provider: string, action: string): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/admin/quota', {
        method: 'PUT',
        body: JSON.stringify({
            provider_overage_actions: { [provider]: action },
        }),
    })

    if (!data.success) {
        throw new Error(data.message || '保存超额策略失败')
    }
}

/** 额度单位格式化(对齐原版单位:auto/k/w/m/token,其中 w=万) */
export function formatQuota(value: number | undefined, unit: string): string {
    const num = Number(value || 0)

    if (!Number.isFinite(num)) {
        return '0'
    }

    const u = String(unit || 'auto').toLowerCase()

    if (u === 'token') {
        return num.toLocaleString()
    }

    if (u === 'k') {
        return `${(num / 1000).toFixed(1)}K`
    }

    if (u === 'w') {
        return `${(num / 10000).toFixed(2)}w`
    }

    if (u === 'm') {
        return `${(num / 1000000).toFixed(2)}M`
    }

    // auto:按数量级自动选择
    if (num >= 100000000) {
        return `${(num / 1000000).toFixed(1)}M`
    }

    if (num >= 10000) {
        return `${(num / 10000).toFixed(1)}w`
    }

    if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}K`
    }

    return String(num)
}