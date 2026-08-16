/**
 * knowledge.ts — 知识库 API
 */

import { apiFetch } from './client'

export interface KnowledgeItem {
    title: string
    pin?: boolean
    model_readonly?: boolean
}

interface KnowledgeSidebarResponse {
    success: boolean
    knowledge: KnowledgeItem[]
    basis_knowledge?: Record<string, unknown>
    [key: string]: unknown
}

/** 获取聊天侧栏知识库数据(不含正文) */
export async function fetchKnowledgeSidebar(): Promise<KnowledgeItem[]> {
    const data = await apiFetch<KnowledgeSidebarResponse>('/api/knowledge/sidebar')

    return Array.isArray(data.knowledge) ? data.knowledge : []
}
