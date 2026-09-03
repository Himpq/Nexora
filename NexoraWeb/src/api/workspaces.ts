/**
 * workspaces.ts — Workspaces 项目 API
 *
 * 对应后端路由(api/App/Workspace/routes.py):
 *   GET    /api/workspace/list?include_marks=1   项目列表
 *   POST   /api/workspace/create                 创建项目
 *   GET    /api/workspace/<id>                   项目详情
 *   DELETE /api/workspace/<id>                   删除项目
 *   POST   /api/workspace/<id>/settings          更新设置(改名/共享)
 *   POST   /api/workspace/<id>/conversations/<cid>/visibility 对话可见性
 *   POST   /api/workspace/<id>/conversations/<cid>/pin        对话置顶
 *   GET    /api/workspace/<id>/conversations/<cid>            共享对话只读读取(跨用户)
 *   POST   /api/workspace/<id>/knowledge          归入知识库
 *   POST   /api/workspace/<id>/knowledge/blank    新建空白知识库
 *   POST   /api/workspace/<id>/knowledge/visibility 知识库可见性
 *   POST   /api/workspace/<id>/knowledge/pin      知识库置顶
 *   POST   /api/workspace/<id>/files              添加云端文件
 *   POST   /api/workspace/<id>/files/visibility   文件可见性
 *   POST   /api/workspace/<id>/files/pin          文件置顶
 *   GET    /api/workspace/<id>/files/read         文件预览(跨用户走 added_by)
 *   GET    /api/workspace/<id>/files/download     文件下载/内联(缩略图同源)
 *   POST   /api/workspace/<id>/tasks              新建任务
 *   POST   /api/workspace/<id>/tasks/<tid>        更新任务
 *   DELETE /api/workspace/<id>/tasks/<tid>        删除任务
 */

import { apiFetch } from './client'

import type { ChatMessage } from './conversations'

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
    updated_at?: string
    created_at?: string
    last_user_question?: string
    visibility?: string
    pin?: boolean
    [key: string]: unknown
}

export interface WorkspaceKnowledgeDocument {
    title: string
    knowledge_type?: string
    added_by?: string
    added_at?: string
    updated_at?: string
    created_at?: string
    basis_id?: string
    visibility?: string
    pin?: boolean
    [key: string]: unknown
}

export interface WorkspaceFileEntry {
    file_ref: string
    alias?: string
    title?: string
    original_name?: string
    source_ext?: string
    added_by?: string
    added_at?: string
    updated_at?: string
    created_at?: string
    size?: number
    visibility?: string
    pin?: boolean
    [key: string]: unknown
}

export interface WorkspaceTaskEntry {
    task_id?: string
    title?: string
    status?: string
    priority?: string
    color?: string
    assignee?: string
    start_date?: string
    due_date?: string
    notes?: string
    source_type?: string
    source_title?: string
    source_ref?: string
    created_at?: string
    [key: string]: unknown
}

/** 任务新建/更新的提交载荷(对齐原版 getWorkspaceTaskModalPayload) */
export interface WorkspaceTaskPayload {
    title: string
    status: string
    color: string
    assignee: string
    start_date: string
    due_date: string
    source_type: string
    source_title: string
    source_ref: string
    notes: string
}

/** 草稿条目(模型通过 workspace_draft_add 写入或用户手动添加,存于 workspace_drafts) */
export interface WorkspaceDraftEntry {
    draft_id?: string
    title?: string
    content?: string
    added_by?: string
    added_at?: string
    [key: string]: unknown
}

/** 草稿新建载荷 */
export interface WorkspaceDraftPayload {
    title: string
    content: string
}

export interface WorkspaceMemory {
    enabled?: boolean
    content?: string
    updated_at?: string
    [key: string]: unknown
}

/** 活动流条目(后端 _normalize_workspace_activity 输出) */
export interface WorkspaceActivityItem {
    activity_id?: string
    action: string
    resource_type: string
    title: string
    subtitle?: string
    actor?: string
    time: string
    ref?: string
    metadata?: Record<string, string>
    [key: string]: unknown
}

/** 总览聚合(后端 _build_workspace_overview 输出) */
export interface WorkspaceOverview {
    resource_counts?: {
        conversations?: number
        knowledge_documents?: number
        workspace_files?: number
        workspace_tasks?: number
        workspace_drafts?: number
    }
    task_status_counts?: Record<string, number>
    open_task_count?: number
    overdue_task_count?: number
    upcoming_tasks?: WorkspaceTaskEntry[]
    recent_items?: Array<Record<string, unknown>>
    activity_items?: WorkspaceActivityItem[]
    pinned_resources?: Array<Record<string, unknown>>
}

export interface WorkspaceDetail extends WorkspaceSummary {
    conversations?: WorkspaceConversation[]
    knowledge_documents?: WorkspaceKnowledgeDocument[]
    workspace_files?: WorkspaceFileEntry[]
    workspace_tasks?: WorkspaceTaskEntry[]
    workspace_drafts?: WorkspaceDraftEntry[]
    workspace_memory?: WorkspaceMemory
    overview?: WorkspaceOverview
    [key: string]: unknown
}

/** 用户搜索条目(/api/user/search,共享弹窗选择用户用) */
export interface WorkspaceUserOption {
    user_id?: string
    username?: string
    display_name?: string
    avatar_url?: string
    role?: string
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

/** 共享对话只读读取响应(后端 get_visible_conversation 输出) */
export interface WorkspaceSharedConversation {
    conversation: {
        conversation_id?: string
        title?: string
        messages?: Array<Partial<ChatMessage>>
    }
    marker?: WorkspaceConversation
    readonly: boolean
    owner_username: string
    workspace_id: string
    workspace_title: string
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

/** 知识库置顶/取消置顶(对齐原版 updateWorkspaceKnowledgePin,knowledge_type 固定 basis 体系) */
export async function pinWorkspaceKnowledge(
    workspaceId: string,
    title: string,
    addedBy: string,
    pin: boolean,
    knowledgeType = 'basis'
): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/knowledge/pin`,
        { method: 'POST', body: JSON.stringify({ title, knowledge_type: knowledgeType, added_by: addedBy, pin }) }
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

/** 从项目移除文件标记(右键菜单取消归入,镜像 removeWorkspaceConversation;仅移除当前用户添加的标记) */
export async function removeWorkspaceFile(workspaceId: string, fileRef: string): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/files`,
        { method: 'DELETE', body: JSON.stringify({ file_ref: fileRef }) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '取消归入失败')
    }

    return data.workspace
}

/** 添加云端文件到项目(对齐原版 add_workspace_file) */
export async function addWorkspaceFile(workspaceId: string, fileRef: string): Promise<WorkspaceDetail> {    const data = await apiFetch<WorkspaceMutationResponse>(
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

/** 对话归入项目(Workspace 详情页输入框发送新对话后登记,对齐原版 addConversationToWorkspace) */
export async function addWorkspaceConversation(workspaceId: string, conversationId: string): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/conversations`,
        { method: 'POST', body: JSON.stringify({ conversation_id: conversationId }) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '对话归入失败')
    }

    return data.workspace
}

/**
 * 读取他人共享进项目的对话(只读;后端按 viewer 校验可见性)。
 * 返回值已把消息数组映射为 ChatMessage(补 index),供消息区直接渲染。
 */
export async function fetchSharedWorkspaceConversation(workspaceId: string, conversationId: string): Promise<{
    title: string
    ownerUsername: string
    workspaceTitle: string
    messages: ChatMessage[]
}> {
    const data = await apiFetch<WorkspaceSharedConversation>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}`
    )

    if (!data.conversation) {
        throw new Error('共享对话读取失败')
    }

    const rawMessages = Array.isArray(data.conversation.messages) ? data.conversation.messages : []

    return {
        title: String(data.conversation.title || data.marker?.title || conversationId).trim(),
        ownerUsername: String(data.owner_username || '').trim(),
        workspaceTitle: String(data.workspace_title || '').trim(),
        // 落库消息与 /messages 同构(缺 index),此处补齐后按 ChatMessage 消费
        messages: rawMessages.map((message, index) => ({ ...message, index }) as ChatMessage),
    }
}

/** 新建项目任务(对齐原版 create_workspace_task) */
export async function createWorkspaceTask(workspaceId: string, task: WorkspaceTaskPayload): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/tasks`,
        { method: 'POST', body: JSON.stringify(task) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '创建任务失败')
    }

    return data.workspace
}

/** 更新任务(对齐原版 updateWorkspaceTask;支持部分字段,如仅 status) */
export async function updateWorkspaceTask(workspaceId: string, taskId: string, task: Partial<WorkspaceTaskPayload>): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}`,
        { method: 'POST', body: JSON.stringify(task) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '任务保存失败')
    }

    return data.workspace
}

/** 删除任务(对齐原版 deleteWorkspaceTask) */
export async function deleteWorkspaceTask(workspaceId: string, taskId: string): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}`,
        { method: 'DELETE' }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '任务删除失败')
    }

    return data.workspace
}

/** 新建草稿条目(模型工具与手动新建共用后端入口) */
export async function createWorkspaceDraft(workspaceId: string, draft: WorkspaceDraftPayload): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/drafts`,
        { method: 'POST', body: JSON.stringify(draft) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '创建草稿失败')
    }

    return data.workspace
}

/** 删除草稿条目 */
export async function deleteWorkspaceDraft(workspaceId: string, draftId: string): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/drafts/${encodeURIComponent(draftId)}`,
        { method: 'DELETE' }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '草稿删除失败')
    }

    return data.workspace
}

/** 对话可见性切换(对齐原版 updateWorkspaceConversationVisibility) */
export async function updateConversationVisibility(workspaceId: string, conversationId: string, visibility: string): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/visibility`,
        { method: 'POST', body: JSON.stringify({ visibility }) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '共享状态保存失败')
    }

    return data.workspace
}

/** 知识库可见性切换(对齐原版 updateWorkspaceKnowledgeVisibility) */
export async function updateKnowledgeVisibility(workspaceId: string, title: string, visibility: string, knowledgeType = 'basis'): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/knowledge/visibility`,
        { method: 'POST', body: JSON.stringify({ title, knowledge_type: knowledgeType, visibility }) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '共享状态保存失败')
    }

    return data.workspace
}

/** 文件可见性切换(对齐原版 updateWorkspaceFileVisibility) */
export async function updateFileVisibility(workspaceId: string, fileRef: string, visibility: string): Promise<WorkspaceDetail> {
    const data = await apiFetch<WorkspaceMutationResponse>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/files/visibility`,
        { method: 'POST', body: JSON.stringify({ file_ref: fileRef, visibility }) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '共享状态保存失败')
    }

    return data.workspace
}

/** 新建空白知识库并归入项目(对齐原版 createBlankKnowledgeInWorkspace) */
export async function createBlankWorkspaceKnowledge(workspaceId: string, titlePrefix: string): Promise<{ title: string; workspace: WorkspaceDetail }> {
    const data = await apiFetch<WorkspaceMutationResponse & { title?: string }>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/knowledge/blank`,
        { method: 'POST', body: JSON.stringify({ title_prefix: titlePrefix }) }
    )

    if (!data.success || !data.workspace) {
        throw new Error(data.message || '空白知识库创建失败')
    }

    return { title: String(data.title || ''), workspace: data.workspace }
}

/**
 * Workspace 文件下载/内联 URL(缩略图与预览同源)。
 * added_by 用于跨用户读取共享资源,后端据此定位文件归属沙箱。
 */
export function workspaceFileUrl(workspaceId: string, fileRef: string, addedBy = '', inline = false): string {
    const params = new URLSearchParams()

    params.set('file_ref', fileRef)

    if (addedBy) {
        params.set('added_by', addedBy)
    }

    if (inline) {
        params.set('inline', '1')
    }

    return `/api/workspace/${encodeURIComponent(workspaceId)}/files/download?${params.toString()}`
}

/** 读取 Workspace 文件文本预览(走项目接口,支持跨用户共享文件) */
export async function readWorkspaceFile(workspaceId: string, fileRef: string, addedBy = ''): Promise<{ content: string; truncated: boolean }> {
    const params = new URLSearchParams()

    params.set('file_ref', fileRef)

    if (addedBy) {
        params.set('added_by', addedBy)
    }

    const data = await apiFetch<{ success: boolean; content?: string; truncated?: boolean; message?: string }>(
        `/api/workspace/${encodeURIComponent(workspaceId)}/files/read?${params.toString()}`
    )

    if (!data.success) {
        throw new Error(data.message || '文件读取失败')
    }

    return {
        content: String(data.content || ''),
        truncated: Boolean(data.truncated),
    }
}

/** 用户搜索(共享弹窗选择用户,/api/user/search) */
export async function searchWorkspaceUsers(query = '', limit = 20): Promise<WorkspaceUserOption[]> {
    const params = new URLSearchParams()

    params.set('q', query)
    params.set('limit', String(limit))

    const data = await apiFetch<{ success: boolean; items?: WorkspaceUserOption[]; message?: string }>(`/api/user/search?${params.toString()}`)

    if (!data.success) {
        throw new Error(data.message || '用户列表加载失败')
    }

    return Array.isArray(data.items) ? data.items : []
}

/**
 * 项目时间显示(对齐原版 formatWorkspaceDate):
 *   - 纯数字(含小数 epoch,如 1787080769.0539062)按时间戳解析,
 *     >1e11 视为毫秒,否则秒,兼容后端新旧字段与浮点精度尾巴
 *   - 输出紧凑的「M月D日」;无法解析时原样返回
 */
export function formatWorkspaceDate(raw: string | number | undefined): string {
    const value = String(raw ?? '').trim()

    if (!value) {
        return '-'
    }

    // 允许小数 epoch(后端偶发带精度尾巴的时间戳),Number() 可直接吃掉小数点
    const numeric = Number(value)

    const date = Number.isFinite(numeric) && numeric > 0
        ? new Date(numeric > 100000000000 ? numeric : numeric * 1000)
        : new Date(value)

    if (Number.isNaN(date.getTime())) {
        return value
    }

    return `${date.getMonth() + 1}月${date.getDate()}日`
}