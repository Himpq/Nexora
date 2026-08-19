/**
 * workspaces.ts — Workspaces 项目 API
 *
 * 对应后端路由(api/App/Workspace/routes.py):
 *   GET    /api/workspace/list?include_marks=1   项目列表
 *   POST   /api/workspace/create                 创建项目
 *   GET    /api/workspace/<id>                   项目详情
 *   DELETE /api/workspace/<id>                   删除项目
 *   POST   /api/workspace/<id>/settings          更新设置(改名/共享)
 *   POST   /api/workspace/<id>/conversations/<cid>/pin        对话置顶
 *   POST   /api/workspace/<id>/knowledge/pin                 知识库置顶
 *   POST   /api/workspace/<id>/files/pin                     文件置顶
 *   POST   /api/workspace/<id>/files            添加云端文件
 *   POST   /api/workspace/<id>/tasks            新建任务
 */

import { apiFetch } from './client'

export interface WorkspaceSummary {
    workspace_id: string
    title: string
    updated_at?: string
    created_at?: string
    owner_username?: string
    conversation_count?: number
    knowledge_document_count?: number
    workspace_file_count?: number
    workspace_task_count?: number
    open_task_count?: number
    shared_users?: string[]
    /** include_marks=1 时的标记数据:已归入的对话/知识/文件 */
    conversation_ids?: string[]
    conversations?: WorkspaceConversation[]
    knowledge_documents?: WorkspaceKnowledgeDocument[]
    workspace_files?: WorkspaceFileEntry[]
    [key: string]: unknown
}

export interface WorkspaceConversation {
    conversation_id: string
    title?: string
    added_by?: string
    added_at?: string
    visibility?: string
    pin?: boolean
    [key: string]: unknown
}

export interface WorkspaceKnowledgeDocument {
    title: string
    knowledge_type?: string
    visibility?: string
    added_by?: string
    pin?: boolean
    [key: string]: unknown
}

export interface WorkspaceFileEntry {
    file_ref: string
    alias?: string
    visibility?: string
    added_by?: string
    pin?: boolean
    [key: string]: unknown
}

export interface WorkspaceTaskEntry {
    task_id?: string
    title?: string
    status?: string
    priority?: string
    created_at?: string
    [key: string]: unknown
}

export interface WorkspaceMemory {
    enabled?: boolean
    content?: string
    updated_at?: string
    [key: string]: unknown
}

export interface WorkspaceDetail extends WorkspaceSummary {
    conversations?: WorkspaceConversation[]
    knowledge_documents?: WorkspaceKnowledgeDocument[]
    workspace_files?: WorkspaceFileEntry[]
    workspace_tasks?: WorkspaceTaskEntry[]
    workspace_memory?: WorkspaceMemory
    overview?: {
        activity_items?: Array<{
            action: string
            title: string
            time: string
            actor?: string
        }>
        [key: string]: unknown
    }
    [key: string]: unknown
}

interface WorkspaceListResponse {
    success: boolean
    workspaces?: WorkspaceSummary[]
}

interface WorkspaceDetailResponse {
    success: boolean
    workspace?: WorkspaceDetail
}

interface WorkspaceMutationResponse {
    success: boolean
    workspace?: WorkspaceDetail
    message?: string
}

/** 拉取项目列表(include_marks 对齐原版 loadWorkspaceProjects) */
export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
    const data = await apiFetch<WorkspaceListResponse>('/api/workspace/list?include_marks=1')

    return Array.isArray(data.workspaces) ? data.workspaces : []
}

/** 创建项目 */
export async function createWorkspace(title: string): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceDetailResponse>('/api/workspace/create', {
        method: 'POST',
        body: JSON.stringify({ title }),
    })

    if (!data.workspace) {
        throw new Error('创建失败')
    }

    return data.workspace
}

/** 拉取项目详情 */
export async function fetchWorkspace(workspaceId: string): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceDetailResponse>(`/api/workspace/${encodeURIComponent(workspaceId)}`)

    if (!data.workspace) {
        throw new Error('项目不存在')
    }

    return data.workspace
}

/** 删除项目 */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
    await apiFetch<{ success: boolean }>(`/api/workspace/${encodeURIComponent(workspaceId)}`, {
        method: 'DELETE',
    })
}

/** 更新项目设置(重命名 / 共享用户) */
export async function updateWorkspaceSettings(workspaceId: string, patch: {
    title?: string
    shared_users?: string[]
}): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(`/api/workspace/${encodeURIComponent(workspaceId)}/settings`, {
        method: 'POST',
        body: JSON.stringify(patch),
    })

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '保存设置失败')
    }

    return data.workspace
}

/** 对话置顶/取消置顶(对齐原版 updateWorkspaceConversationPin) */
export async function pinWorkspaceConversation(workspaceId: string, conversationId: string, pin: boolean): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/pin`,
        { method: 'POST', body: JSON.stringify({ pin }) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '置顶失败')
    }

    return data.workspace
}

/** 知识库置顶/取消置顶(对齐原版 updateWorkspaceKnowledgePin) */
export async function pinWorkspaceKnowledge(
    workspaceId: string,
    title: string,
    addedBy: string,
    pin: boolean
): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/knowledge/pin`,
        { method: 'POST', body: JSON.stringify({ title, added_by: addedBy, pin }) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '置顶失败')
    }

    return data.workspace
}

/** 云端文件置顶/取消置顶(对齐原版 updateWorkspaceFilePin) */
export async function pinWorkspaceFile(
    workspaceId: string,
    fileRef: string,
    addedBy: string,
    pin: boolean
): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/files/pin`,
        { method: 'POST', body: JSON.stringify({ file_ref: fileRef, added_by: addedBy, pin }) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '置顶失败')
    }

    return data.workspace
}

/** 添加云端文件到项目(对齐原版 add_workspace_file) */
export async function addWorkspaceFile(workspaceId: string, fileRef: string): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/files`,
        { method: 'POST', body: JSON.stringify({ file_ref: fileRef }) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '添加文件失败')
    }

    return data.workspace
}

/** 添加基础知识到项目(对齐原版 addKnowledgeToWorkspace) */
export async function addWorkspaceKnowledge(workspaceId: string, title: string): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/knowledge`,
        { method: 'POST', body: JSON.stringify({ title, knowledge_type: 'basis' }) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '知识归入失败')
    }

    return data.workspace
}

/** 从项目移除对话(右键菜单再次点击取消归入) */
export async function removeWorkspaceConversation(workspaceId: string, conversationId: string): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}`,
        { method: 'DELETE' }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '取消归入失败')
    }

    return data.workspace
}

/** 从项目移除基础知识(右键菜单再次点击取消归入) */
export async function removeWorkspaceKnowledge(workspaceId: string, title: string): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/knowledge`,
        { method: 'DELETE', body: JSON.stringify({ title, knowledge_type: 'basis' }) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '取消归入失败')
    }

    return data.workspace
}

/** 新建项目任务(对齐原版 create_workspace_task) */
export async function createWorkspaceTask(workspaceId: string, task: Record<string, unknown>): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/tasks`,
        { method: 'POST', body: JSON.stringify(task) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '创建任务失败')
    }

    return data.workspace
}

/** 项目时间显示(对齐原版 formatWorkspaceDate) */
export function formatWorkspaceDate(raw: string | undefined): string {
    const value = String(raw || '').trim()

    if (!value) {
        return '-'
    }

    try {
        return new Date(value).toLocaleString()
    } catch {
        return value
    }
}