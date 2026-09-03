/**
 * admin-models.ts — 管理员:模型管理 API
 *
 * 对应后端路由:
 *   GET  /api/admin/models/config                    模型/Provider 配置
 *   POST /api/admin/models/model/upsert              新增/更新模型
 *   POST /api/admin/models/provider/upsert           新增/更新 Provider
 *   POST /api/admin/models/model/delete              删除模型
 *   POST /api/admin/models/provider/delete           删除 Provider
 */

import { apiFetch } from './client'

export interface ModelInfo {
    name?: string
    provider?: string
    status?: string
    context_window?: number
    [key: string]: unknown
}

export interface ModelsConfig {
    models: Record<string, ModelInfo>
    providers: Record<string, Record<string, unknown>>
}

interface ModelsConfigResponse {
    success: boolean
    models?: Record<string, ModelInfo>
    providers?: Record<string, Record<string, unknown>>
}

interface MutationResponse {
    success: boolean
    message?: string
}

/** 读取模型/Provider 配置 */
export async function fetchModelsConfig(): Promise<ModelsConfig> {
    const data = await apiFetch<ModelsConfigResponse>('/api/admin/models/config')

    return {
        models: data.models && typeof data.models === 'object' ? data.models as Record<string, ModelInfo> : {},
        providers: data.providers && typeof data.providers === 'object' ? data.providers as Record<string, Record<string, unknown>> : {},
    }
}

/** 新增/更新模型(对齐原版 admin_upsert_model;编辑时传 original_model_id) */
export async function upsertModel(options: {
    model_id: string
    original_model_id?: string
    name?: string
    provider: string
    status?: string
    context_window?: number
}): Promise<void> {
    const data = await apiFetch<MutationResponse>('/api/admin/models/model/upsert', {
        method: 'POST',
        body: JSON.stringify(options),
    })

    if (!data.success) {
        throw new Error(data.message || '保存模型失败')
    }
}

/** 新增/更新 Provider(对齐原版 admin_upsert_provider) */
export async function upsertProvider(options: {
    provider: string
    original_provider?: string
    api_key?: string
    base_url?: string
    api_type?: string
    user_agent?: string
    enable_search?: boolean
    settings?: Record<string, unknown>
}): Promise<void> {
    const data = await apiFetch<MutationResponse>('/api/admin/models/provider/upsert', {
        method: 'POST',
        body: JSON.stringify(options),
    })

    if (!data.success) {
        throw new Error(data.message || '保存供应商失败')
    }
}

/** 删除 Provider(需确认文本 确认修改) */
export async function deleteProvider(provider: string, confirmText: string): Promise<void> {
    const data = await apiFetch<MutationResponse>('/api/admin/models/provider/delete', {
        method: 'POST',
        body: JSON.stringify({ provider, confirm_text: confirmText }),
    })

    if (!data.success) {
        throw new Error(data.message || '删除供应商失败')
    }
}

/** 删除模型(需确认文本 确认修改) */
export async function deleteModel(modelId: string, confirmText: string): Promise<void> {
    const data = await apiFetch<MutationResponse>('/api/admin/models/model/delete', {
        method: 'POST',
        body: JSON.stringify({ model_id: modelId, confirm_text: confirmText }),
    })

    if (!data.success) {
        throw new Error(data.message || '删除模型失败')
    }
}
