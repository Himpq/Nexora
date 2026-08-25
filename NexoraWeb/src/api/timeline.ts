/**
 * timeline.ts — 时间线 API
 *
 * 对应后端路由:
 *   GET /api/timeline?limit=N  知识库/笔记变更记录
 */

import { apiFetch } from './client'

export interface TimelineEntry {
    ts: number
    title: string
    kind?: string
    type?: string
    update_by?: string
    difference?: string
}

interface TimelineResponse {
    success: boolean
    items?: TimelineEntry[]
}

/** 拉取时间线条目(limit 对齐原版 fetchTimelineEntries 的 120) */
export async function fetchTimelineEntries(limit = 120): Promise<TimelineEntry[]> {
    const data = await apiFetch<TimelineResponse>(`/api/timeline?limit=${limit}`)

    return Array.isArray(data.items) ? data.items : []
}
