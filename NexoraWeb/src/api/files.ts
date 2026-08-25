/**
 * files.ts — 云端文件 API
 */

import { apiFetch } from './client'

export interface CloudFileItem {
    name: string
    size?: number
    path?: string
    mime?: string
    [key: string]: unknown
}

interface FilesListResponse {
    success: boolean
    files: CloudFileItem[]
    total: number
}

/** 列出当前用户的云端文件 */
export async function listCloudFiles(options: { query?: string } = {}): Promise<CloudFileItem[]> {
    const params = new URLSearchParams()

    if (options.query) {
        params.set('q', options.query)
    }

    const query = params.toString()
    const data = await apiFetch<FilesListResponse>(`/api/files/list${query ? `?${query}` : ''}`)

    return Array.isArray(data.files) ? data.files : []
}
