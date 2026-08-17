/**
 * admin-ollama.ts — 管理员:Ollama 模型状态(对齐原版 chat.js loadAdminOllamaStatusForProvider / toggleAdminOllamaModelStatus)
 *
 * 对应后端路由:
 *   GET  /api/provider/ollama/list?provider=<key>&timeout=8   拉取该 provider 全部模型状态
 *   POST /api/admin/models/ollama/toggle                       加载/卸载模型(keep_alive)
 */

import { apiFetch } from './client'

/** 单个模型的状态条目(对齐原版 byModelId 记录) */
export interface OllamaModelStatus {
    id?: string
    model?: string
    name?: string
    installed?: boolean
    running?: boolean
    status?: string
    status_label?: string
    status_level?: string
    keep_alive?: string
    message?: string
    tag?: { name?: string; model?: string; id?: string } | null
    ps?: { name?: string; model?: string; id?: string } | null
    [key: string]: unknown
}

/** provider 级状态缓存(对齐原版 adminOllamaModelStatusCache[key]) */
export interface OllamaProviderStatus {
    byModelId: Record<string, OllamaModelStatus>
    raw: unknown
    error: string
    loaded: boolean
    loadedAt: number
}

interface OllamaListResponse {
    success: boolean
    message?: string
    models?: OllamaModelStatus[]
    [key: string]: unknown
}

interface OllamaToggleResponse {
    success: boolean
    message?: string
    status?: OllamaModelStatus
    [key: string]: unknown
}

/**
 * 拉取指定 provider 的 Ollama 模型状态(键为小写模型 id,对齐原版 byModelId)
 */
export async function fetchOllamaProviderStatus(providerKey: string): Promise<OllamaProviderStatus> {
    const data = await apiFetch<OllamaListResponse>(`/api/provider/ollama/list?provider=${encodeURIComponent(providerKey)}&timeout=8`)

    const byModelId: Record<string, OllamaModelStatus> = {}
    const rows = Array.isArray(data.models) ? data.models : []

    for (const row of rows) {
        const modelKey = String((row && (row.id || row.model || row.name)) || '').trim().toLowerCase()

        if (!modelKey) {
            continue
        }

        byModelId[modelKey] = {
            ...row,
            installed: row && row.installed !== undefined ? Boolean(row.installed) : true,
            running: Boolean(row && row.running),
            status: String((row && row.status) || '').trim().toLowerCase() || (row && row.running ? 'running' : 'offline'),
            status_label: String((row && row.status_label) || (row && row.running ? '在线' : '不在线')),
            status_level: String((row && row.status_level) || (row && row.running ? 'success' : 'warning')),
        }
    }

    return {
        byModelId,
        raw: data,
        error: data && data.success === false ? (data.message || '加载失败') : '',
        loaded: !(data && data.success === false),
        loadedAt: Date.now(),
    }
}

/**
 * 加载/卸载 Ollama 模型(对齐原版 toggleAdminOllamaModelStatus)
 * action: load | unload | toggle
 */
export async function toggleOllamaModelStatus(options: {
    provider: string
    model_id: string
    action: 'load' | 'unload' | 'toggle'
    keep_alive?: string
}): Promise<OllamaModelStatus> {
    const data = await apiFetch<OllamaToggleResponse>('/api/admin/models/ollama/toggle', {
        method: 'POST',
        body: JSON.stringify(options),
    })

    if (!data.success && !data.status) {
        throw new Error(data.message || '切换失败')
    }

    return (data.status || { ...data }) as OllamaModelStatus
}
