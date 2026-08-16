/**
 * admin-stats.ts — 管理员:统计信息 API
 *
 * 对应后端路由:
 *   GET /api/admin/tokens/stats     所有用户总 token 消耗
 */

import { apiFetch } from './client'

interface TokenStatsResponse {
    success: boolean
    total?: number
}

/** 获取全站总 token 消耗 */
export async function fetchAdminTokenStats(): Promise<number> {
    const data = await apiFetch<TokenStatsResponse>('/api/admin/tokens/stats')

    return Number(data.total || 0)
}
