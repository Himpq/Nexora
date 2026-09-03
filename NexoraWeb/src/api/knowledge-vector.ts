/**
 * knowledge-vector.ts — 知识库向量 / Chroma 域 API
 *
 * 拆分自 knowledge.ts 的向量链路，避免单文件堆屎山。
 * 覆盖后端：
 *   POST /api/knowledge/vectorize           (同步 chunk 级，向量单条)
 *   POST /api/knowledge/vectorize/chunk     (分块向量化)
 *   POST /api/knowledge/vector/tasks        (异步批量向量化任务)
 *   GET  /api/knowledge/vector/tasks/<id>   (任务轮询)
 *   POST /api/knowledge/vector/tasks/<id>/cancel
 *   GET  /api/knowledge/vector/status       (能力探测)
 *   GET  /api/knowledge/vector/config       (配置)
 *   POST /api/knowledge/vector/chunks       (按标题拉分块)
 *   DELETE /api/knowledge/vector/titles/<title> | /chunks/<id> | POST /delete
 *   POST /api/knowledge/vector/mark         (标记已同步)
 *   POST /api/knowledge/query               (语义检索)
 */

import { apiFetch } from './client'

// ---------- 类型 ----------

export interface VectorStatus {
    enabled: boolean
    vectorization_enabled: boolean
    reason: string
    mode: string
    chunk_size: number
    chunk_overlap: number
}

export interface VectorChunk {
    id: string
    document?: string
    text?: string
    metadata?: Record<string, unknown>
    [key: string]: unknown
}

export interface VectorTask {
    task_id: string
    status: string
    stage: string
    progress: number
    message?: string
    error?: string
    result?: Record<string, unknown>
    library?: string
    title?: string
}

export interface QueryResult {
    ids?: string[][]
    documents?: string[][]
    metadatas?: Record<string, unknown>[][]
    distances?: number[][]
    [key: string]: unknown
}

// ---------- 能力探测 ----------

export async function fetchVectorStatus(): Promise<VectorStatus> {
    const data = await apiFetch<{ success: boolean } & VectorStatus>('/api/knowledge/vector/status')

    return {
        enabled: Boolean((data as unknown as Record<string, unknown>).enabled),
        vectorization_enabled: Boolean((data as unknown as Record<string, unknown>).vectorization_enabled),
        reason: String((data as unknown as Record<string, unknown>).reason || ''),
        mode: String((data as unknown as Record<string, unknown>).mode || ''),
        chunk_size: Number((data as unknown as Record<string, unknown>).chunk_size || 800),
        chunk_overlap: Number((data as unknown as Record<string, unknown>).chunk_overlap || 120),
    }
}

export async function fetchVectorConfig(): Promise<VectorStatus> {
    const data = await apiFetch<{ success: boolean } & VectorStatus>('/api/knowledge/vector/config')

    return {
        enabled: Boolean((data as unknown as Record<string, unknown>).enabled),
        vectorization_enabled: Boolean((data as unknown as Record<string, unknown>).vectorization_enabled),
        reason: String((data as unknown as Record<string, unknown>).reason || ''),
        mode: String((data as unknown as Record<string, unknown>).mode || ''),
        chunk_size: Number((data as unknown as Record<string, unknown>).chunk_size || 800),
        chunk_overlap: Number((data as unknown as Record<string, unknown>).chunk_overlap || 120),
    }
}

// ---------- 向量化任务（异步） ----------

export async function createVectorTask(title: string, library: string = 'knowledge'): Promise<string> {
    const data = await apiFetch<{ success: boolean; task_id: string; message?: string }>('/api/knowledge/vector/tasks', {
        method: 'POST',
        body: JSON.stringify({ title, library }),
    })

    if (!data.success || !data.task_id) {
        throw new Error(data.message || '创建向量化任务失败')
    }

    return data.task_id
}

export async function fetchVectorTask(taskId: string): Promise<VectorTask> {
    const data = await apiFetch<{ success: boolean; task: VectorTask; message?: string }>(`/api/knowledge/vector/tasks/${encodeURIComponent(taskId)}`)

    if (!data.success || !data.task) {
        throw new Error(data.message || '查询向量化任务失败')
    }

    return data.task
}

export async function cancelVectorTask(taskId: string): Promise<void> {
    await apiFetch(`/api/knowledge/vector/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: 'POST',
    })
}

/**
 * 轮询直到完成/失败/取消，progress 回调透传阶段进度。
 * 对齐原版 pollKnowledgeVectorTask 的 400ms 节奏与 1200 轮上限。
 */
export async function pollVectorTask(
    taskId: string,
    onProgress?: (info: { status: string; stage: string; progress: number; task: VectorTask }) => void,
): Promise<VectorTask> {
    const maxRounds = 1200

    for (let i = 0; i < maxRounds; i += 1) {
        const task = await fetchVectorTask(taskId)
        const status = String(task.status || '').toLowerCase()
        const stage = String(task.stage || '').toLowerCase()
        const progress = Number.isFinite(Number(task.progress)) ? Math.max(0, Math.min(100, Number(task.progress))) : 0

        if (onProgress) {
            onProgress({ status, stage, progress, task })
        }

        if (status === 'completed') {
            return task
        }

        if (status === 'failed') {
            throw new Error(task.error || task.message || '向量化失败')
        }

        if (status === 'cancelled') {
            throw new Error(task.message || '任务已取消')
        }

        await new Promise((resolve) => setTimeout(resolve, 400))
    }

    throw new Error('向量化任务超时')
}

// ---------- 同步向量化（单条 / 分块） ----------

export async function vectorizeChunk(
    title: string,
    text: string,
    chunkId?: string | number,
    chunkTotal?: number,
    library: string = 'knowledge',
): Promise<string> {
    const data = await apiFetch<{ success: boolean; vector_id?: string; message?: string }>('/api/knowledge/vectorize/chunk', {
        method: 'POST',
        body: JSON.stringify({
            title,
            text,
            chunk_id: chunkId,
            chunk_total: chunkTotal,
            library,
        }),
    })

    if (!data.success) {
        throw new Error(data.message || '分块向量化失败')
    }

    return data.vector_id || ''
}

// ---------- 分块查询 / 删除 ----------

export async function fetchVectorChunks(title: string, library: string = 'knowledge'): Promise<VectorChunk[]> {
    const data = await apiFetch<{ success: boolean; chunks?: VectorChunk[]; message?: string }>('/api/knowledge/vector/chunks', {
        method: 'POST',
        body: JSON.stringify({ title, library }),
    })

    if (!data.success) {
        throw new Error(data.message || '获取向量分块失败')
    }

    return Array.isArray(data.chunks) ? data.chunks : []
}

export async function deleteVectorsByTitle(title: string, library: string = 'knowledge'): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>(`/api/knowledge/vector/titles/${encodeURIComponent(title)}?library=${encodeURIComponent(library)}`, {
        method: 'DELETE',
    })

    if (!data.success) {
        throw new Error(data.message || '删除向量失败')
    }
}

export async function deleteVectorById(vectorId: string): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>(`/api/knowledge/vector/chunks/${encodeURIComponent(vectorId)}`, {
        method: 'DELETE',
    })

    if (!data.success) {
        throw new Error(data.message || '删除向量分块失败')
    }
}

export async function deleteVectorsByPost(title?: string, vectorId?: string, library: string = 'knowledge'): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/knowledge/vector/delete', {
        method: 'POST',
        body: JSON.stringify({ title, vector_id: vectorId, library }),
    })

    if (!data.success) {
        throw new Error(data.message || '删除向量失败')
    }
}

export async function markVectorUpdated(title: string): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/knowledge/vector/mark', {
        method: 'POST',
        body: JSON.stringify({ title }),
    })

    if (!data.success) {
        throw new Error(data.message || '标记向量时间失败')
    }
}

// ---------- 语义检索 ----------

export async function queryKnowledgeVectors(query: string, topK: number = 5, library: string = 'knowledge'): Promise<QueryResult> {
    const data = await apiFetch<{ success: boolean; result?: QueryResult; message?: string }>('/api/knowledge/query', {
        method: 'POST',
        body: JSON.stringify({ query, text: query, top_k: topK, library }),
    })

    if (!data.success) {
        throw new Error(data.message || '向量检索失败')
    }

    return data.result || {}
}
