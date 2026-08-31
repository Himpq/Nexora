/**
 * workspaceContext.ts — Workspaces 视图的动作注入契约
 *
 * 职责:
 *   - 根组件 WorkspacesView 提供唯一实现(状态编排 + API 调用 + 弹窗调度),
 *     详情壳与各面板通过 typed InjectionKey 注入使用,消除三层 emit 转发样板
 *   - 面板只表达"意图",所有副作用收敛在根组件
 */

import type { InjectionKey, Ref } from 'vue'
import { inject } from 'vue'

import type { WorkspaceDraftEntry, WorkspaceFileEntry, WorkspaceTaskEntry } from '@/api/workspaces'

/** 详情 tab 名(根组件持有当前值,保存任务等场景需要切回 tasks) */
export type WorkspaceDetailTab = 'overview' | 'chat' | 'knowledge' | 'files' | 'tasks' | 'drafts' | 'memory'

/** 可操作资源定位(置顶/可见性切换共用) */
export interface WorkspaceResourceRef {
    type: 'conversation' | 'knowledge' | 'file'
    /** conversation=会话ID / knowledge=标题 / file=file_ref */
    ref: string
    addedBy: string
    /** 当前可见性(private/share),仅可见性切换使用 */
    visibility?: string
    /** 知识库类型,当前恒为 basis */
    knowledgeType?: string
}

/** 日历格点击时的排期预设(新建任务带入日期) */
export interface WorkspaceTaskDraftOptions {
    date?: string
    startDate?: string
    dueDate?: string
}

/** 打开对话时传给宿主(ChatView)的定位信息;ownerUsername 非当前用户时走只读共享视图 */
export interface WorkspaceConversationOpenMeta {
    workspaceId: string
    workspaceTitle: string
    ownerUsername: string
}

/** 根组件向子树暴露的全部动作 */
export interface WorkspaceActions {
    /** 当前登录用户 ID(owner_username 存登录名,比对用它而非显示名) */
    currentUserId(): string

    /** 置顶/取消置顶(带 toast 与失败提示) */
    toggleResourcePin(target: WorkspaceResourceRef, nextPin: boolean): Promise<void>

    /** 切换共享状态(仅资源添加者可操作,由面板负责禁用) */
    toggleResourceVisibility(target: WorkspaceResourceRef, next: string): Promise<void>

    /** 右键菜单 */
    openResourceMenu(event: MouseEvent, target: WorkspaceResourceRef): void

    /** 打开资源(meta 由根组件按资源归属补全,他人共享的对话走只读打开) */
    openConversation(conversationId: string, addedBy?: string): void
    openKnowledge(title: string): void
    openFile(file: WorkspaceFileEntry): void

    /** 文件页工具 */
    pickCloudFiles(): void
    uploadWorkspaceFiles(files: FileList | File[]): Promise<void>

    /** 任务编辑弹窗(task 为 null 时是新建,options 携带日历点选日期) */
    editTask(task: WorkspaceTaskEntry | null, options?: WorkspaceTaskDraftOptions): void
    changeTaskStatus(task: WorkspaceTaskEntry, status: string): Promise<void>
    removeTask(task: WorkspaceTaskEntry): Promise<void>

    /** 草稿(模型工具与手动新建共用;删除仅手动) */
    addDraft(title: string, content: string): Promise<boolean>
    removeDraft(draft: WorkspaceDraftEntry): Promise<void>

    /** 分享弹窗 */
    openShareModal(): void

    /** 详情头部动作(内联改名 / 删除项目 / 新建空白知识库) */
    renameWorkspace(title: string): Promise<boolean>
    deleteWorkspace(): Promise<void>
    createBlankKnowledge(titlePrefix: string): Promise<void>
}

export const WORKSPACE_ACTIONS_KEY: InjectionKey<WorkspaceActions> = Symbol('WorkspaceActions')

/** 可见性开关保存中状态:值为正在保存的资源行键(resourceRowKey),空串表示空闲 */
export const WORKSPACE_VISIBILITY_SAVING_KEY: InjectionKey<Ref<string>> = Symbol('WorkspaceVisibilitySaving')

/** 面板内统一取用动作(须在 setup 上下文调用;根组件必提供,缺失即编程错误,直接抛出暴露问题) */
export function useWorkspaceActions(): WorkspaceActions {
    const actions = inject(WORKSPACE_ACTIONS_KEY)

    if (!actions) {
        throw new Error('[Workspaces] WorkspaceActions 未提供:面板必须在 WorkspacesView 子树内使用')
    }

    return actions
}

/** 面板内读取可见性开关保存中状态(根组件必提供) */
export function useVisibilitySavingKey(): Ref<string> {
    const savingKey = inject(WORKSPACE_VISIBILITY_SAVING_KEY)

    if (!savingKey) {
        throw new Error('[Workspaces] VisibilitySaving 未提供:面板必须在 WorkspacesView 子树内使用')
    }

    return savingKey
}
