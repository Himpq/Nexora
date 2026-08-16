/**
 * admin-gen-image.ts — 管理员:生图 API 配置
 *
 * 对应后端路由:
 *   GET  /api/admin/gen-image/apis          接口列表
 *   POST /api/admin/gen-image/apis          新增接口
 *   PUT  /api/admin/gen-image/apis/<id>     更新接口
 */

import { apiFetch } from './client'

export interface GenImageApi {
    id: string
    name?: string
    base_url?: string
    api_key?: string
    model?: string
    enabled?: boolean
    [key: string]: unknown
}

interface GenImageListResponse {
    success: boolean
    apis?: GenImageApi[] | Record<string, GenImageApi>
    enabled_api?: string
    [key: string]: unknown
}

interface MutationResponse {
    success: boolean
    message?: string
}

/** 读取生图接口列表(后端返回 apis 为数组,每项含 api_id) */
export async function fetchGenImageApis(): Promise<{ apis: GenImageApi[]; enabledApi: string }> {
    const data = await apiFetch<GenImageListResponse>('/api/admin/gen-image/apis')

    const raw: GenImageApi[] = Array.isArray(data.apis)
        ? data.apis
        : Object.values((data.apis as Record<string, GenImageApi>) || {})

    return {
        apis: raw
            .map((api) => ({
                ...api,
                id: String(api.api_id || api.id || ''),
            }))
            .filter((api) => Boolean(api.id)),
        enabledApi: String(data.enabled_api || ''),
    }
}

/** 新增/更新生图接口(对齐原版 admin_upsert_gen_image_api) */
export async function upsertGenImageApi(options: {
    api_id: string
    name?: string
    api_type?: string
    api_key?: string
    base_url?: string
    model?: string
    size?: string
    enabled?: boolean
}): Promise<void> {
    const data = await apiFetch<MutationResponse>('/api/admin/gen-image/apis/upsert', {
        method: 'POST',
        body: JSON.stringify(options),
    })

    if (!data.success) {
        throw new Error(data.message || '保存接口失败')
    }
}

/** 启用接口(同一时间仅一个接口可用) */
export async function enableGenImageApi(apiId: string): Promise<void> {
    const data = await apiFetch<MutationResponse>('/api/admin/gen-image/apis/enable', {
        method: 'POST',
        body: JSON.stringify({ api_id: apiId }),
    })

    if (!data.success) {
        throw new Error(data.message || '启用失败')
    }
}

/** 停用接口 */
export async function disableGenImageApi(apiId: string): Promise<void> {
    const data = await apiFetch<MutationResponse>('/api/admin/gen-image/apis/disable', {
        method: 'POST',
        body: JSON.stringify({ api_id: apiId }),
    })

    if (!data.success) {
        throw new Error(data.message || '停用失败')
    }
}

/** 删除接口 */
export async function deleteGenImageApi(apiId: string): Promise<void> {
    const data = await apiFetch<MutationResponse>('/api/admin/gen-image/apis/delete', {
        method: 'POST',
        body: JSON.stringify({ api_id: apiId }),
    })

    if (!data.success) {
        throw new Error(data.message || '删除失败')
    }
}
