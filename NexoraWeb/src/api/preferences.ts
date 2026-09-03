/**
 * preferences.ts — 用户偏好设置 API
 *
 * 对应后端路由:
 *   GET /api/user/preferences   读取偏好
 *   PUT /api/user/preferences   保存偏好(theme/streaming/language/learning_mode 等)
 */

import { apiFetch } from './client'

export interface UserPreferences {
    default_model?: string
    theme?: string
    streaming?: boolean
    language?: string
    learning_mode?: string
    /** 用户级 Learning 入口开关(随偏好持久化) */
    learning_runtime?: { enabled?: boolean }
    memory_update_model?: string
    default_open_view?: string
    [key: string]: unknown
}

/** 管理端 Learning 运行时配置(响应顶层,非用户偏好) */
export interface LearningRuntimeConfig {
    enabled?: boolean
    /** Learning 前端应用页面地址(iframe 挂载用) */
    frontend_url?: string
    base_path?: string
    request_timeout?: number
}

interface PreferencesResponse {
    success: boolean
    preferences?: UserPreferences
    message?: string
    learning_runtime?: LearningRuntimeConfig
}

/** 偏好 + Learning 运行时配置的整体载荷 */
export interface UserPreferencesPayload {
    preferences: UserPreferences
    learning_runtime?: LearningRuntimeConfig
}

/** 读取当前用户偏好 */
export async function fetchUserPreferences(): Promise<UserPreferences | null> {
    const data = await apiFetch<PreferencesResponse>('/api/user/preferences')

    return data.preferences || null
}

/** 读取偏好与 Learning 运行时配置(learning_runtime 运行时配置在响应顶层,与 preferences 平级) */
export async function fetchUserPreferencesPayload(): Promise<UserPreferencesPayload> {
    const data = await apiFetch<PreferencesResponse>('/api/user/preferences')

    return {
        preferences: data.preferences || {},
        learning_runtime: data.learning_runtime,
    }
}

/** 保存偏好(仅提交存在的键) */
export async function saveUserPreferences(updates: UserPreferences): Promise<UserPreferences | null> {
    const data = await apiFetch<PreferencesResponse>('/api/user/preferences', {
        method: 'PUT',
        body: JSON.stringify(updates),
    })

    if (!data.success) {
        throw new Error(data.message || '保存失败')
    }

    return data.preferences || null
}
