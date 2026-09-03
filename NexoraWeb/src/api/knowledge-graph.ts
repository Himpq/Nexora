/**
 * knowledge-graph.ts — 知识图谱 / 分类 / 连接 / AI 整理域 API
 *
 * 与 knowledge-vector.ts 同为 knowledge.ts 的拆分文件，避免单文件堆屎山。
 * 覆盖后端：
 *   GET  /api/knowledge/list                (完整 meta 列表，供图谱/向量刷新判断)
 *   GET  /api/knowledge/graph               (图谱数据)
 *   POST /api/knowledge/graph/positions     (保存图谱位置)
 *   PUT  /api/knowledge/graph/nodes/positions | /api/knowledge/nodes/positions
 *   POST /api/knowledge/categories          (创建分类)
 *   DELETE /api/knowledge/categories/<name>
 *   PUT  /api/knowledge/categories/<name>
 *   POST /api/knowledge/move                (移动知识到分类)
 *   POST /api/knowledge/connections         (创建连接)
 *   DELETE /api/knowledge/connections/<id>
 *   POST /api/knowledge/ai/organize | /ai/scan | /ai/index
 *   POST /api/knowledge/layout              (自动布局)
 *   POST /api/knowledge/short/clear         (清空短期记忆)
 *   GET  /api/knowledge/export/word         (导出 Word)
 */

import { apiFetch } from './client'

// ---------- 类型 ----------

export interface KnowledgeListPayload {
    basis_knowledge: Record<string, Record<string, unknown>>
    user_profile_memory?: string
    short_memory_disabled?: boolean
    vectorization_enabled?: boolean
    [key: string]: unknown
}

export interface KnowledgeGraph {
    categories: Record<string, { name: string; knowledge_ids: string[]; color?: string; [k: string]: unknown }>
    connections: Array<{ id: string; source: string; target: string; [k: string]: unknown }>
    positions?: Record<string, { x: number; y: number }>
    [key: string]: unknown
}

// ---------- 列表 / 导出 / 清空 ----------

export async function fetchKnowledgeListFull(title?: string, workspaceId?: string): Promise<KnowledgeListPayload> {
    const params = new URLSearchParams()

    if (title) {
        params.set('title', title)
    }

    if (workspaceId) {
        params.set('workspace_id', workspaceId)
    }

    const qs = params.toString()
    const url = qs ? `/api/knowledge/list?${qs}` : '/api/knowledge/list'
    const data = await apiFetch<{ success: boolean; message?: string } & KnowledgeListPayload>(url)

    if (!data.success) {
        throw new Error(data.message || '获取知识列表失败')
    }

    return data
}

export async function exportKnowledgeWord(title?: string): Promise<Blob> {
    const qs = title ? `?title=${encodeURIComponent(title)}` : ''
    const res = await fetch(`/api/knowledge/export/word${qs}`, {
        credentials: 'include',
    })

    if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.message || `导出失败(${res.status})`)
    }

    return await res.blob()
}

export async function clearShortMemory(): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/knowledge/short/clear', {
        method: 'POST',
    })

    if (!data.success) {
        throw new Error(data.message || '清空短期记忆失败')
    }
}

// ---------- 图谱 ----------

export async function fetchKnowledgeGraph(): Promise<KnowledgeGraph> {
    const data = await apiFetch<{ success: boolean; message?: string } & KnowledgeGraph>('/api/knowledge/graph')

    if (!data.success) {
        throw new Error(data.message || '获取知识图谱失败')
    }

    return data
}

export async function saveGraphPositions(positions: Record<string, { x: number; y: number }>): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/knowledge/graph/positions', {
        method: 'POST',
        body: JSON.stringify({ positions }),
    })

    if (!data.success) {
        throw new Error(data.message || '保存图谱位置失败')
    }
}

export async function updateNodePositions(positions: Record<string, { x: number; y: number }>): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/knowledge/graph/nodes/positions', {
        method: 'PUT',
        body: JSON.stringify({ positions }),
    })

    if (!data.success) {
        throw new Error(data.message || '更新节点位置失败')
    }
}

// ---------- 分类 ----------

export async function createCategory(name: string): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/knowledge/categories', {
        method: 'POST',
        body: JSON.stringify({ name }),
    })

    if (!data.success) {
        throw new Error(data.message || '创建分类失败')
    }
}

export async function deleteCategory(name: string): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>(`/api/knowledge/categories/${encodeURIComponent(name)}`, {
        method: 'DELETE',
    })

    if (!data.success) {
        throw new Error(data.message || '删除分类失败')
    }
}

export async function updateCategory(oldName: string, newName: string): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>(`/api/knowledge/categories/${encodeURIComponent(oldName)}`, {
        method: 'PUT',
        body: JSON.stringify({ name: newName }),
    })

    if (!data.success) {
        throw new Error(data.message || '更新分类失败')
    }
}

export async function moveKnowledge(title: string, category: string): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/knowledge/move', {
        method: 'POST',
        body: JSON.stringify({ title, category }),
    })

    if (!data.success) {
        throw new Error(data.message || '移动知识失败')
    }
}

// ---------- 连接 ----------

export async function createConnection(source: string, target: string): Promise<{ id: string } & Record<string, unknown>> {
    const data = await apiFetch<{ success: boolean; id?: string; message?: string } & Record<string, unknown>>('/api/knowledge/connections', {
        method: 'POST',
        body: JSON.stringify({ source, target }),
    })

    if (!data.success) {
        throw new Error(data.message || '创建连接失败')
    }

    return data as { id: string } & Record<string, unknown>
}

export async function deleteConnection(connectionId: string): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>(`/api/knowledge/connections/${encodeURIComponent(connectionId)}`, {
        method: 'DELETE',
    })

    if (!data.success) {
        throw new Error(data.message || '删除连接失败')
    }
}

// ---------- AI 整理 / 索引 / 布局 ----------

export async function aiOrganize(): Promise<unknown> {
    const data = await apiFetch<{ success: boolean; message?: string } & Record<string, unknown>>('/api/knowledge/ai/organize', {
        method: 'POST',
    })

    if (!data.success) {
        throw new Error(data.message || 'AI 整理失败')
    }

    return data
}

export async function aiScanLinks(): Promise<unknown> {
    const data = await apiFetch<{ success: boolean; message?: string } & Record<string, unknown>>('/api/knowledge/ai/scan', {
        method: 'POST',
    })

    if (!data.success) {
        throw new Error(data.message || 'AI 扫描失败')
    }

    return data
}

export async function aiGenerateIndex(): Promise<unknown> {
    const data = await apiFetch<{ success: boolean; message?: string } & Record<string, unknown>>('/api/knowledge/ai/index', {
        method: 'POST',
    })

    if (!data.success) {
        throw new Error(data.message || 'AI 索引生成失败')
    }

    return data
}

export async function autoLayout(): Promise<unknown> {
    const data = await apiFetch<{ success: boolean; message?: string } & Record<string, unknown>>('/api/knowledge/layout', {
        method: 'POST',
    })

    if (!data.success) {
        throw new Error(data.message || '自动布局失败')
    }

    return data
}
