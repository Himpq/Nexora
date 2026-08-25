/**
 * trash.ts — 回收站 API
 *
 * 对应后端路由:
 *   GET    /api/trash/list?limit=N        列出回收站条目
 *   POST   /api/trash/<trash_id>/restore  恢复单个条目
 *   DELETE /api/trash                     清空回收站
 */

import { apiFetch } from './client'

export interface TrashItem {
    id: string
    type: string
    title: string
    preview: string
    deleted_at: string
    changed_at: string
    conversation_id: string
    knowledge_title: string
}

interface TrashListResponse {
    success: boolean
    items: TrashItem[]
    count: number
}

interface TrashClearResponse {
    success: boolean
    removed: number
}

/** 拉取回收站条目列表 */
export async function listTrashItems(limit = 200): Promise<TrashItem[]> {
    const data = await apiFetch<TrashListResponse>(`/api/trash/list?limit=${limit}`)

    return Array.isArray(data.items) ? data.items : []
}

/** 恢复单个回收站条目 */
export async function restoreTrashItem(trashId: string): Promise<void> {
    await apiFetch<{ success: boolean }>(`/api/trash/${encodeURIComponent(trashId)}/restore`, {
        method: 'POST',
    })
}

/** 清空回收站,返回移除数量 */
export async function clearTrashItems(): Promise<number> {
    const data = await apiFetch<TrashClearResponse>('/api/trash', {
        method: 'DELETE',
    })

    return Number(data.removed || 0)
}
