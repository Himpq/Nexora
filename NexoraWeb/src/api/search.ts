/**
 * search.ts — 全局搜索 API
 *
 * 对应后端路由:
 *   GET /api/search/global?q=<keyword>
 *
 * 返回四类结果:会话标题命中 / 消息全文命中 / 知识库命中 / 云盘文件命中
 */

import { apiFetch } from './client'

export interface SearchTitleHit {
    conversation_id: string
    title: string
    updated_at?: unknown
    preview?: string
}

export interface SearchMessageHit {
    conversation_id: string
    title: string
    role: string
    message_index: number
    snippet: string
    updated_at?: unknown
}

export interface SearchKnowledgeHit {
    title: string
    snippet: string
}

export interface SearchFileHit {
    alias: string
    name: string
}

export interface GlobalSearchResult {
    success: boolean
    keyword: string
    titles: SearchTitleHit[]
    messages: SearchMessageHit[]
    knowledge: SearchKnowledgeHit[]
    files: SearchFileHit[]
    scanned_conversations?: number
}

/** 全局搜索(命令面板数据源) */
export async function globalSearch(keyword: string): Promise<GlobalSearchResult> {
    const q = String(keyword || '').trim()

    const data = await apiFetch<GlobalSearchResult>(`/api/search/global?q=${encodeURIComponent(q)}`)

    return {
        success: !!data.success,
        keyword: String(data.keyword || ''),
        titles: Array.isArray(data.titles) ? data.titles : [],
        messages: Array.isArray(data.messages) ? data.messages : [],
        knowledge: Array.isArray(data.knowledge) ? data.knowledge : [],
        files: Array.isArray(data.files) ? data.files : [],
        scanned_conversations: data.scanned_conversations,
    }
}
