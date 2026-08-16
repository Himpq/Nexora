/**
 * user-keys.ts — 我的 API Key 管理
 *
 * 对应后端路由:
 *   GET    /api/user/papi-keys                      列表 + expire_options + permission_labels
 *   POST   /api/user/papi-keys                      创建(返回明文 plain_key)
 *   PUT    /api/user/papi-keys/<id>                 更新名称/权限/有效期
 *   POST   /api/user/papi-keys/<id>/regenerate      轮换
 *   DELETE /api/user/papi-keys/<id>                 删除
 */

import { apiFetch } from './client'

export interface UserApiKey {
    id: string
    name: string
    key_preview: string
    created_at?: number
    expires_at?: number
    expire_option?: string
    permissions?: string[]
}

export interface ExpireOption {
    id: string
    label: string
}

interface UserApiKeyListResponse {
    success: boolean
    keys?: UserApiKey[]
    expire_options?: ExpireOption[]
    permission_labels?: Record<string, string>
    public_api_enabled?: boolean
}

interface UserApiKeyMutationResponse {
    success: boolean
    key?: UserApiKey
    plain_key?: string
    /** 创建/轮换成功后的一次性明文 Key(后端字段为 public_api_key) */
    public_api_key?: string
    message?: string
}

/** 拉取 API Key 列表与元数据 */
export async function listUserApiKeys(): Promise<{
    keys: UserApiKey[]
    expireOptions: ExpireOption[]
    permissionLabels: Record<string, string>
}> {
    const data = await apiFetch<UserApiKeyListResponse>('/api/user/papi-keys')

    return {
        keys: Array.isArray(data.keys) ? data.keys : [],
        expireOptions: Array.isArray(data.expire_options) ? data.expire_options : [],
        permissionLabels: data.permission_labels && typeof data.permission_labels === 'object'
            ? data.permission_labels as Record<string, string>
            : {},
    }
}

/** 创建 API Key;成功返回明文 plain_key(仅此一次可见);后端字段名为 expire */
export async function createUserApiKey(options: {
    name: string
    expire?: string
    permissions?: string[]
}): Promise<{ key: UserApiKey; plainKey: string }> {
    const data = await apiFetch<UserApiKeyMutationResponse>('/api/user/papi-keys', {
        method: 'POST',
        body: JSON.stringify({
            name: options.name,
            expire: options.expire,
            permissions: options.permissions,
        }),
    })

    if (!data.key) {
        throw new Error(data.message || '创建失败')
    }

    return {
        key: data.key,
        plainKey: String(data.public_api_key || data.plain_key || ''),
    }
}

/** 更新 API Key(名称/权限/有效期);后端更新走 POST 且字段为 expire */
export async function updateUserApiKey(keyId: string, options: {
    name?: string
    expire?: string
    permissions?: string[]
}): Promise<UserApiKey> {
    const data = await apiFetch<UserApiKeyMutationResponse>(`/api/user/papi-keys/${encodeURIComponent(keyId)}`, {
        method: 'POST',
        body: JSON.stringify({
            name: options.name,
            expire: options.expire,
            permissions: options.permissions,
        }),
    })

    if (!data.key) {
        throw new Error(data.message || '更新失败')
    }

    return data.key
}

/** 轮换 API Key */
export async function regenerateUserApiKey(keyId: string): Promise<{ key: UserApiKey; plainKey: string }> {
    const data = await apiFetch<UserApiKeyMutationResponse>(`/api/user/papi-keys/${encodeURIComponent(keyId)}/regenerate`, {
        method: 'POST',
    })

    if (!data.key) {
        throw new Error(data.message || '轮换失败')
    }

    return {
        key: data.key,
        plainKey: String(data.public_api_key || data.plain_key || ''),
    }
}

/** 删除 API Key */
export async function deleteUserApiKey(keyId: string): Promise<void> {
    await apiFetch<{ success: boolean }>(`/api/user/papi-keys/${encodeURIComponent(keyId)}`, {
        method: 'DELETE',
    })
}
