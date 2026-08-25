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
    learning_runtime?: { enabled?: boolean; frontend_url?: string }
    memory_update_model?: string
    default_open_view?: string
    [key: string]: unknown
}

interface PreferencesResponse {
    success: boolean
    preferences?: UserPreferences
    message?: string
}

/** 读取当前用户偏好 */
export async function fetchUserPreferences(): Promise<UserPreferences | null> {
    const data = await apiFetch<PreferencesResponse>('/api/user/preferences')

    return data.preferences || null
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
