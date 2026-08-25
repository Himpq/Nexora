/**
 * tokens.ts — Token 使用统计 API
 *
 * 职责:
 *   - 封装 /api/tokens/* 两个原始接口,供新版 Token 详情弹窗使用
 *   - 对齐旧版 chat.js:9366 / chat_token_details.js:139 的 fetch 逻辑
 */

import { apiFetch } from './client'

/** 单条 Token 日志(对齐 server.py _build_stats_from_logs 与 TokenUsageDetailPresenter) */
export interface TokenLog {
    timestamp: string
    conversation_id?: string
    conversation_title?: string
    action: string
    input_tokens: number
    output_tokens: number
    total_tokens: number
    detail_ref?: string
    model?: string
}

/** Token 统计结果(对齐 GET /api/tokens/stats) */
export interface TokenStats {
    input_total: number
    output_total: number
    total: number
    today_input: number
    today_output: number
    today: number
    history: TokenLog[]
    conversation_id?: string | null
}

interface TokenStatsResponse {
    success: boolean
    input_total?: number
    output_total?: number
    total?: number
    today_input?: number
    today_output?: number
    today?: number
    history?: TokenLog[]
    conversation_id?: string | null
    message?: string
}

/** Token 调用详情(对齐 GET /api/tokens/detail) */
export interface TokenDetail {
    title: string
    timestamp: string
    action: string
    model?: string
    input_tokens: number
    output_tokens: number
    user_markdown: string
    response_markdown: string
}

interface TokenDetailResponse {
    success: boolean
    detail?: TokenDetail
    message?: string
}

/** 获取 Token 统计 */
export async function fetchTokenStats(conversationId?: string): Promise<TokenStats> {
    const qs = conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : ''
    const data = await apiFetch<TokenStatsResponse>(`/api/tokens/stats${qs}`)

    if (!data.success) {
        throw new Error(data.message || '获取 Token 统计失败')
    }

    return {
        input_total: Number(data.input_total || 0),
        output_total: Number(data.output_total || 0),
        total: Number(data.total || 0),
        today_input: Number(data.today_input || 0),
        today_output: Number(data.today_output || 0),
        today: Number(data.today || 0),
        history: Array.isArray(data.history) ? data.history as TokenLog[] : [],
        conversation_id: data.conversation_id ?? null,
    }
}

/** 按 detail_ref 读取单条 Token 调用详情 */
export async function fetchTokenDetail(detailRef: string): Promise<TokenDetail> {
    const data = await apiFetch<TokenDetailResponse>(`/api/tokens/detail?ref=${encodeURIComponent(detailRef)}`)

    if (!data.success || !data.detail) {
        throw new Error(data.message || 'Token 详情读取失败')
    }

    return data.detail
}
