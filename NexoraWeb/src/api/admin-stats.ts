/**
 * admin-stats.ts — 管理员:统计信息 API
 *
 * 对应后端路由:
 *   GET /api/admin/tokens/stats                    全站总 token
 *   GET /api/admin/tokens/timeseries?days=30       Token 按天趋势
 *   GET /api/admin/tokens/stats/user?username=&range=  单用户 Token 统计
 *   GET /api/admin/tools/stats?days=30             工具调用观测
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

/** Token 按天趋势(对齐原版 adminTokenTrendChart) */
export interface TokenTimeseries {
    labels: string[]
    series: {
        input_tokens: number[]
        output_tokens: number[]
        total_tokens: number[]
        requests: number[]
    }
    top_providers: Array<{ name: string; tokens: number; requests: number }>
    top_models: Array<{ name: string; tokens: number; requests: number }>
}

interface TimeseriesResponse {
    success: boolean
    labels?: string[]
    series?: TokenTimeseries['series']
    top_providers?: TokenTimeseries['top_providers']
    top_models?: TokenTimeseries['top_models']
}

export async function fetchTokenTimeseries(days = 30): Promise<TokenTimeseries> {
    const data = await apiFetch<TimeseriesResponse>(`/api/admin/tokens/timeseries?days=${days}`)

    return {
        labels: Array.isArray(data.labels) ? data.labels : [],
        series: {
            input_tokens: Array.isArray(data.series?.input_tokens) ? data.series.input_tokens : [],
            output_tokens: Array.isArray(data.series?.output_tokens) ? data.series.output_tokens : [],
            total_tokens: Array.isArray(data.series?.total_tokens) ? data.series.total_tokens : [],
            requests: Array.isArray(data.series?.requests) ? data.series.requests : [],
        },
        top_providers: Array.isArray(data.top_providers) ? data.top_providers : [],
        top_models: Array.isArray(data.top_models) ? data.top_models : [],
    }
}

/** 单用户 Token 统计 */
export interface UserTokenStats {
    username: string
    range: string
    matched_logs: number
    summary: {
        requests: number
        input_tokens: number
        output_tokens: number
        total_tokens: number
        papi_requests: number
        papi_input_tokens: number
        papi_output_tokens: number
        papi_total_tokens: number
    }
    top_providers: Array<{ name: string; tokens: number; requests: number }>
    top_models: Array<{ name: string; tokens: number; requests: number }>
    sources: Array<{ name: string; tokens: number; requests: number }>
    recent: Array<{
        timestamp: string
        source: string
        provider: string
        model: string
        action: string
        input_tokens: number
        output_tokens: number
        total_tokens: number
        duration_ms: number
    }>
}

interface UserTokenStatsResponse {
    success: boolean
    matched_logs?: number
    summary?: UserTokenStats['summary']
    top_providers?: UserTokenStats['top_providers']
    top_models?: UserTokenStats['top_models']
    sources?: UserTokenStats['sources']
    recent?: UserTokenStats['recent']
    message?: string
}

/** 查询单个用户的 Token 统计(对齐原版 adminUserTokenStatsQuery) */
export async function fetchUserTokenStats(username: string, range = '30d'): Promise<UserTokenStats> {
    const data = await apiFetch<UserTokenStatsResponse>(
        `/api/admin/tokens/stats/user?username=${encodeURIComponent(username)}&range=${encodeURIComponent(range)}`
    )

    if (!data.success) {
        throw new Error(data.message || '查询失败')
    }

    return {
        username,
        range,
        matched_logs: Number(data.matched_logs || 0),
        summary: {
            requests: Number(data.summary?.requests || 0),
            input_tokens: Number(data.summary?.input_tokens || 0),
            output_tokens: Number(data.summary?.output_tokens || 0),
            total_tokens: Number(data.summary?.total_tokens || 0),
            papi_requests: Number(data.summary?.papi_requests || 0),
            papi_input_tokens: Number(data.summary?.papi_input_tokens || 0),
            papi_output_tokens: Number(data.summary?.papi_output_tokens || 0),
            papi_total_tokens: Number(data.summary?.papi_total_tokens || 0),
        },
        top_providers: Array.isArray(data.top_providers) ? data.top_providers : [],
        top_models: Array.isArray(data.top_models) ? data.top_models : [],
        sources: Array.isArray(data.sources) ? data.sources : [],
        recent: Array.isArray(data.recent) ? data.recent : [],
    }
}

/** 工具调用观测(对齐原版 Tool Observability) */
export interface ToolStats {
    days: number
    summary: {
        total_calls: number
        success_calls: number
        error_calls: number
        error_rate: number
        avg_latency_ms: number
    }
    labels: string[]
    series: Array<{ calls: number; errors: number; latency_ms: number }>
    top_tools: Array<{ name: string; calls: number; errors: number; latency_sum_ms: number }>
    top_failed_tools_24h: Array<{ name: string; calls: number; errors: number }>
}

interface ToolStatsResponse {
    success: boolean
    summary?: ToolStats['summary']
    labels?: string[]
    series?: ToolStats['series']
    top_tools?: ToolStats['top_tools']
    top_failed_tools_24h?: ToolStats['top_failed_tools_24h']
    message?: string
}

export async function fetchToolStats(days = 30): Promise<ToolStats> {
    const data = await apiFetch<ToolStatsResponse>(`/api/admin/tools/stats?days=${days}`)

    return {
        days,
        summary: {
            total_calls: Number(data.summary?.total_calls || 0),
            success_calls: Number(data.summary?.success_calls || 0),
            error_calls: Number(data.summary?.error_calls || 0),
            error_rate: Number(data.summary?.error_rate || 0),
            avg_latency_ms: Number(data.summary?.avg_latency_ms || 0),
        },
        labels: Array.isArray(data.labels) ? data.labels : [],
        series: Array.isArray(data.series) ? data.series : [],
        top_tools: Array.isArray(data.top_tools) ? data.top_tools : [],
        top_failed_tools_24h: Array.isArray(data.top_failed_tools_24h) ? data.top_failed_tools_24h : [],
    }
}