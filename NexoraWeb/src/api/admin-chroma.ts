/**
 * admin-chroma.ts — 管理员:向量库统计 API
 *
 * 对应后端路由:
 *   GET /api/admin/chroma/stats    ChromaDB 状态与集合统计
 */

import { apiFetch } from './client'

export interface ChromaStats {
    enabled: boolean
    mode?: string
    service_url?: string
    collections?: Array<Record<string, unknown>>
    total_vectors?: number
    message?: string
}

interface ChromaStatsResponse extends ChromaStats {
    success: boolean
}

/** 读取向量库统计 */
export async function fetchChromaStats(): Promise<ChromaStats> {
    const data = await apiFetch<ChromaStatsResponse>('/api/admin/chroma/stats')

    return {
        enabled: !!data.enabled,
        mode: data.mode,
        service_url: data.service_url,
        collections: Array.isArray(data.collections) ? data.collections : [],
        total_vectors: Number(data.total_vectors || 0),
        message: data.message,
    }
}
