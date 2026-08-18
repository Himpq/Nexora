/**
 * knowledge.ts — 知识库 API
 */

import { apiFetch } from './client'

export interface KnowledgeItem {
    title: string
    pin?: boolean
    model_readonly?: boolean
    updated_at?: string | number
}

interface KnowledgeSidebarResponse {
    success: boolean
    knowledge: KnowledgeItem[]
    basis_knowledge?: Record<string, unknown>
    vectorization_enabled?: boolean
    [key: string]: unknown
}

export interface KnowledgeContent {
    title: string
    content: string
    metadata?: Record<string, unknown>
    content_revision?: string
    content_hash?: string
}

/** 知识库管理页的基础知识条目（含更新时间的列表数据） */
export interface BasisKnowledgeItem {
    title: string
    pin?: boolean
    model_readonly?: boolean
    public?: boolean
    updated_at?: string | number
    basis_id?: string
    content?: string
}

/** 短期记忆条目（当前后端仅一条"用户画像"） */
export interface ShortMemoryItem {
    id: string
    title: string
    content: string
}

interface KnowledgeListResponse {
    success: boolean
    knowledge?: BasisKnowledgeItem[]
    error?: string
    message?: string
}

interface ShortMemoryResponse {
    success: boolean
    memories?: ShortMemoryItem[]
    memory?: ShortMemoryItem
    error?: string
    message?: string
}

interface ShareResponse {
    success: boolean
    message?: string
    share_url?: string
    error?: string
}

/** 获取知识库管理页的基础知识列表（不含正文）。 */
export async function fetchKnowledgeList(): Promise<BasisKnowledgeItem[]> {
    const data = await apiFetch<KnowledgeListResponse>('/api/knowledge/basis?include_content=0')

    return data.success ? (data.knowledge || []) : []
}

/** 新增基础知识。 */
export async function createBasisKnowledge(input: { title: string; content: string; url?: string }): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/knowledge/basis', {
        method: 'POST',
        body: JSON.stringify(input),
    })

    if (!data.success) {
        throw new Error(data.message || '添加知识失败')
    }
}

/** 更新基础知识（title 变化时后端先删旧条再建新条）。 */
export async function updateBasisKnowledge(oldTitle: string, input: { title: string; content: string; url?: string }): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string; error?: string }>(
        `/api/knowledge/basis/${encodeURIComponent(oldTitle)}`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        }
    )

    if (!data.success) {
        throw new Error(data.error || data.message || '保存知识失败')
    }
}

/** 删除基础知识（后端会移入回收站）。 */
export async function deleteBasisKnowledge(title: string): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>(
        `/api/knowledge/basis/${encodeURIComponent(title)}`,
        { method: 'DELETE' }
    )

    if (!data.success) {
        throw new Error(data.message || '删除知识失败')
    }
}

/** 创建空白基础知识库，返回最终标题。 */
export async function createBlankBasis(titlePrefix?: string): Promise<string> {
    const data = await apiFetch<{ success: boolean; title?: string; message?: string }>('/api/knowledge/basis/blank', {
        method: 'POST',
        body: JSON.stringify({ title_prefix: titlePrefix || '未命名知识库' }),
    })

    if (!data.success || !data.title) {
        throw new Error(data.message || '创建空白知识库失败')
    }

    return data.title
}

/** 切换基础知识公开协作状态，返回公开访问链接。 */
export async function setBasisPublic(title: string, isPublic: boolean): Promise<string> {
    const data = await apiFetch<ShareResponse>(`/api/knowledge/basis/${encodeURIComponent(title)}/public`, {
        method: 'PUT',
        body: JSON.stringify({ public: isPublic }),
    })

    if (!data.success) {
        throw new Error(data.message || '切换公开状态失败')
    }

    return data.share_url || ''
}

/** 获取短期记忆列表（当前后端仅返回"用户画像"一条）。 */
export async function fetchShortMemoryList(): Promise<ShortMemoryItem[]> {
    const data = await apiFetch<ShortMemoryResponse>('/api/knowledge/short')

    if (!data.success) {
        throw new Error(data.error || data.message || '加载短期记忆失败')
    }

    return Array.isArray(data.memories) ? data.memories : []
}

/** 新增短期记忆（后端实际更新用户画像）。 */
export async function createShortMemory(title: string, content: string): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string; error?: string }>('/api/knowledge/short', {
        method: 'POST',
        body: JSON.stringify({ title, content }),
    })

    if (!data.success) {
        throw new Error(data.error || data.message || '添加记忆失败')
    }
}

/** 更新短期记忆。 */
export async function updateShortMemory(title: string, content: string): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string; error?: string }>(
        `/api/knowledge/short/${encodeURIComponent(title)}`,
        {
            method: 'PUT',
            body: JSON.stringify({ title, content }),
        }
    )

    if (!data.success) {
        throw new Error(data.error || data.message || '保存记忆失败')
    }
}

/** 删除短期记忆（后端重置用户画像）。 */
export async function deleteShortMemory(title: string): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string; error?: string }>(
        `/api/knowledge/short/${encodeURIComponent(title)}`,
        { method: 'DELETE' }
    )

    if (!data.success) {
        throw new Error(data.error || data.message || '删除记忆失败')
    }
}

/** 上传知识库图片:先分配图片槽位,再上传文件,返回图片访问 URL。 */
export async function uploadKnowledgeImage(file: File, basisTitle: string): Promise<string> {
    const allocated = await apiFetch<{ success: boolean; image_id?: string; message?: string }>(
        '/api/knowledge/image/allocate',
        {
            method: 'POST',
            body: JSON.stringify({
                file_name: file.name || '',
                basis_title: basisTitle,
            }),
        }
    )

    if (!allocated.success || !allocated.image_id) {
        throw new Error(allocated.message || '图片分配失败')
    }

    const form = new FormData()

    form.append('image_id', allocated.image_id)
    form.append('basis_title', basisTitle)
    form.append('file_name', file.name || '')
    form.append('file', file)

    const uploaded = await apiFetch<{ success: boolean; image_url?: string; message?: string }>(
        '/api/knowledge/image/upload',
        {
            method: 'POST',
            body: form,
        }
    )

    if (!uploaded.success || !uploaded.image_url) {
        throw new Error(uploaded.message || '图片上传失败')
    }

    return uploaded.image_url
}

/** 获取聊天侧栏知识库数据(不含正文) */
export async function fetchKnowledgeSidebar(): Promise<KnowledgeItem[]> {
    const data = await apiFetch<KnowledgeSidebarResponse>('/api/knowledge/sidebar')

    return Array.isArray(data.knowledge) ? data.knowledge : []
}

/** 读取知识库 Markdown 正文和版本信息。 */
export async function fetchKnowledgeContent(title: string): Promise<KnowledgeContent> {
    const data = await apiFetch<{ success: boolean; knowledge?: KnowledgeContent; error?: string; message?: string }>(
        `/api/knowledge/basis/${encodeURIComponent(title)}`
    )

    if (!data.knowledge) {
        throw new Error(data.message || data.error || '读取知识库失败')
    }

    return data.knowledge
}

/** 保存知识库 Markdown 正文。 */
export async function saveKnowledgeContent(title: string, content: string, version: Partial<KnowledgeContent> = {}): Promise<KnowledgeContent> {
    const data = await apiFetch<{ success: boolean; title?: string; content_revision?: string; content_hash?: string; message?: string }>(
        `/api/knowledge/basis/${encodeURIComponent(title)}/content`,
        {
            method: 'PUT',
            body: JSON.stringify({
                content,
                base_content_revision: version.content_revision || '',
                base_content_hash: version.content_hash || '',
            }),
        }
    )

    return {
        title: data.title || title,
        content,
        content_revision: data.content_revision,
        content_hash: data.content_hash,
    }
}

/** 重新向量化当前知识库正文。 */
export async function vectorizeKnowledge(title: string, content: string): Promise<void> {
    const data = await apiFetch<{ success: boolean; message?: string }>('/api/knowledge/vectorize', {
        method: 'POST',
        body: JSON.stringify({ title, text: content, library: 'knowledge' }),
    })

    if (!data.success) {
        throw new Error(data.message || '向量化失败')
    }
}

/** 知识库在线协作元数据(存于 fetchKnowledgeContent 返回的 metadata 中)。 */
export interface KnowledgeCollabMeta {
    public?: boolean
    collaborative?: boolean
    share_id?: string
}

/**
 * 读取知识库在线协作元数据(迁移路线:在线编辑 + 光标显示所需字段)。
 *
 * 迁移路线(分阶段):
 *   1. 本函数 + fetchKnowledgeContent.metadata 提供 collab 所需 share_id/public/collaborative;
 *   2. 将原版 static/js/knowledge_collab_client.js 移植为 src/stream/knowledge-collab.ts,
 *      暴露 createClient 契约(getText/setText/getCursorOffset/setCursorOffset/renderMembers/renderCursors),
 *      其 getToastSelectionOffsets/applyToastOperation 直接操作 Toast UI v3.2.2 的 ProseMirror 实例;
 *   3. KnowledgeViewer 在 open 且 meta.public && meta.collaborative 时 startCollab(),
 *      通过本函数建立 ws 连接,渲染成员栏与远程光标 overlay;
 *   4. 后端已就绪:/ws/knowledge/collab/<username>/<share_id>(flask-sock,KnowledgeCollabHub),
 *      前端侧无需改动后端协议。
 */
export function readKnowledgeCollabMeta(metadata?: Record<string, unknown> | null): KnowledgeCollabMeta {
    const raw = (metadata && typeof metadata === 'object') ? metadata : {}

    return {
        public: Boolean(raw.public),
        collaborative: Boolean(raw.collaborative),
        share_id: String(raw.share_id || '') || undefined,
    }
}

/**
 * 构建知识库在线协作 WebSocket 地址(对齐原版 getOwnerKnowledgeCollabWsUrl)。
 * role 为 owner/public 之分;public 页面以 public 角色加入同一 share_id 房间。
 */
export function buildKnowledgeCollabWsUrl(meta: KnowledgeCollabMeta, role: 'owner' | 'public' = 'owner'): string {
    const shareId = String(meta.share_id || '').trim()
    const owner = String(window.location.pathname.split('/').filter(Boolean)[1] || '')

    if (!shareId) {
        return ''
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams()

    params.set('role', role)
    params.set('display_name', '')

    return `${protocol}//${window.location.host}/ws/knowledge/collab/${encodeURIComponent(owner)}/${encodeURIComponent(shareId)}?${params.toString()}`
}
