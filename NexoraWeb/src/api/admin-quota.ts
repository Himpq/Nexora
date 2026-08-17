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

/**
 * 额度显示单位换算(对齐原版 _pickQuotaDisplayUnit + _formatQuotaScaledNumber + _formatQuotaTokens)
 *
 * - auto:按数值大小自动选单位:>=1e6→M, >=1e4→w, >=1e3→K, 否则 token
 * - 固定单位(k/w/m):除以对应除数
 * - 小数位智能:换算后 <10 → 2 位,<100 → 1 位,否则 0 位(避免 100000000 这种长串)
 */
export function formatQuota(value: number | undefined, unit: string): string {
    const numeric = Math.max(0, parseInt(String(value || 0), 10) || 0)

    if (!Number.isFinite(numeric)) {
        return '0'
    }

    const mode = String(unit || 'auto').toLowerCase()
    const picked = mode === 'auto' ? pickQuotaUnit(numeric) : mode

    if (picked === 'token') {
        return numeric.toLocaleString()
    }

    const divisor = picked === 'k' ? 1000 : (picked === 'w' ? 10000 : 1000000)

    return `${formatQuotaScaledNumber(numeric, divisor)}${picked === 'k' ? 'K' : (picked === 'w' ? 'w' : 'M')}`
}

/** auto 模式按数值大小选单位(对齐原版 _pickQuotaDisplayUnit) */
export function pickQuotaUnit(value: number): 'm' | 'w' | 'k' | 'token' {
    const numeric = Math.max(0, Number(value || 0))

    if (numeric >= 1000000) {
        return 'm'
    }

    if (numeric >= 10000) {
        return 'w'
    }

    if (numeric >= 1000) {
        return 'k'
    }

    return 'token'
}

/** 换算后的数字文本(对齐原版 _formatQuotaScaledNumber:按大小决定小数位) */
export function formatQuotaScaledNumber(value: number, divisor: number): string {
    const numeric = Math.max(0, Number(value || 0))
    const scaled = divisor > 0 ? numeric / divisor : numeric
    const absScaled = Math.abs(scaled)
    let digits = 0

    if (absScaled < 10) {
        digits = 2
    } else if (absScaled < 100) {
        digits = 1
    }

    return scaled.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
    })
}