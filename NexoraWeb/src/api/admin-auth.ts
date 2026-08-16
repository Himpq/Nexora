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
    is_expired?: boolean
    [key: string]: unknown
}

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
    message?: string
}

/** 拉取 Public API Keys 列表 */
export async function fetchPublicApiKeys(): Promise<PublicApiKey[]> {
    const data = await apiFetch<AuthKeysResponse>('/api/admin/auth/public-api/keys')

    return Array.isArray(data.keys) ? data.keys : []
}

/** 生成 key */
export async function generatePublicApiKey(name: string): Promise<{ key: PublicApiKey; plainKey: string }> {
    const data = await apiFetch<AuthMutationResponse>('/api/admin/auth/public-api/generate', {
        method: 'POST',
        body: JSON.stringify({ name }),
    })

    if (!data.key) {
        throw new Error(data.message || '生成失败')
    }

    return {
        key: data.key,
        plainKey: String(data.public_api_key || ''),
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
