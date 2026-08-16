/**
 * admin-auth.ts — 管理员:认证管理(Public API Keys)API
 *
 * 对应后端路由:
 *   GET    /api/admin/auth/public-api/keys              key 列表
 *   POST   /api/admin/auth/public-api/generate          生成 key
 *   POST   /api/admin/auth/public-api/regenerate        轮换 key
 *   POST   /api/admin/auth/public-api/revoke            吊销 key
 *   DELETE /api/admin/auth/public-api/keys/<key_id>     删除 key
 */

import { apiFetch } from './client'

export interface PublicApiKey {
    id: string
    name: string
    owner?: string
    scope?: string
    key_preview?: string
    created_at?: string
    expires_at?: string
    expire_option?: string
    is_expired?: boolean
    expires_in_seconds?: number | null
    permissions?: Record<string, boolean>
    [key: string]: unknown
}

/** 权限定义(对齐原版 PUBLIC_API_PERMISSION_LABELS) */
export const PUBLIC_API_PERMISSIONS: Array<{ key: string; label: string }> = [
    { key: 'model_inference', label: '模型推理' },
    { key: 'image_generation', label: '生图 API 调用' },
    { key: 'knowledge_read', label: '知识库读取' },
    { key: 'conversations_read', label: '对话读取' },
    { key: 'conversations_write', label: '对话写入' },
    { key: 'token_stats_read', label: 'Token 统计读取' },
    { key: 'user_read', label: '用户信息读取' },
]

interface AuthKeysResponse {
    success: boolean
    keys?: PublicApiKey[]
    auth?: {
        enabled?: boolean
        has_key?: boolean
        [key: string]: unknown
    }
}

interface AuthMutationResponse {
    success: boolean
    key?: PublicApiKey
    public_api_key?: string
    auth?: {
        keys?: PublicApiKey[]
        selected_key_id?: string
        [key: string]: unknown
    }
    message?: string
}

/** 从 auth 状态里取出新生成的 key(后端 generate/regenerate 返回 auth.keys,无独立 key 字段) */
function pickNewKey(data: AuthMutationResponse): PublicApiKey {
    const keys = Array.isArray(data.auth?.keys) ? data.auth.keys : []
    const selectedId = String(data.auth?.selected_key_id || '')

    const selected = keys.find((key) => key.id === selectedId)

    return selected || keys[keys.length - 1] || { id: '', name: '' }
}

/** 拉取 Public API Keys 列表 */
export async function fetchPublicApiKeys(): Promise<PublicApiKey[]> {
    const data = await apiFetch<AuthKeysResponse>('/api/admin/auth/public-api/keys')

    return Array.isArray(data.keys) ? data.keys : []
}

/** 生成 key(后端必填 expire + scope) */
export async function generatePublicApiKey(
    name: string,
    options: { expire?: string; scope?: string; owner?: string } = {}
): Promise<{ key: PublicApiKey; plainKey: string }> {
    const data = await apiFetch<AuthMutationResponse>('/api/admin/auth/public-api/generate', {
        method: 'POST',
        body: JSON.stringify({
            name,
            expire: options.expire || '7d',
            scope: options.scope || 'owner',
            owner: options.owner || '',
        }),
    })

    const plainKey = String(data.public_api_key || '')

    if (!data.success || !plainKey) {
        throw new Error(data.message || '生成失败')
    }

    return {
        key: pickNewKey(data),
        plainKey,
    }
}

/** 重新生成(轮换)key:旧 key 立即失效(后端必填 expire) */
export async function regeneratePublicApiKey(
    keyId: string,
    name: string,
    options: { expire?: string } = {}
): Promise<{ key: PublicApiKey; plainKey: string }> {
    const data = await apiFetch<AuthMutationResponse>('/api/admin/auth/public-api/regenerate', {
        method: 'POST',
        body: JSON.stringify({
            key_id: keyId,
            name,
            expire: options.expire || '7d',
        }),
    })

    const plainKey = String(data.public_api_key || '')

    if (!data.success || !plainKey) {
        throw new Error(data.message || '重新生成失败')
    }

    return {
        key: pickNewKey(data),
        plainKey,
    }
}

/** 吊销 key */
export async function revokePublicApiKey(keyId: string): Promise<void> {
    const data = await apiFetch<AuthMutationResponse>('/api/admin/auth/public-api/revoke', {
        method: 'POST',
        body: JSON.stringify({ key_id: keyId }),
    })

    if (!data.success) {
        throw new Error(data.message || '吊销失败')
    }
}

/** 保存 key 设置(名称/访问范围/所属用户/权限) */
export async function savePublicApiKeySettings(keyId: string, patch: {
    name?: string
    scope?: string
    owner?: string
    permissions?: Record<string, boolean>
    expire?: string
}): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/admin/auth/public-api/settings', {
        method: 'POST',
        body: JSON.stringify({ key_id: keyId, ...patch }),
    })

    if (!data.success) {
        throw new Error(data.message || '保存失败')
    }
}
