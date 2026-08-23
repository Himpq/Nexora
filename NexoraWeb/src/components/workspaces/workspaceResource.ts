/**
 * workspaceResource.ts — Workspace 资源行共享逻辑
 *
 * 职责:
 *   - 收敛对话/知识库/文件三个面板重复的行级判定与构造逻辑:
 *     可见性可编辑判定、资源 ref 构造、保存中键、开关目标判定、显示文案
 *   - 面板只保留各自的模板结构,行为全部从这里取用
 */

import type { CloudFileItem } from '@/api/files-center'
import type {
    WorkspaceConversation,
    WorkspaceDetail,
    WorkspaceFileEntry,
    WorkspaceKnowledgeDocument,
} from '@/api/workspaces'

import { normalizeVisibility } from './workspaceDisplay'
import type { WorkspaceResourceRef } from './workspaceContext'

/** 资源添加者显示文案(空 added_by 回落项目创建者语义,对齐原版 isWorkspaceResourceOwnedByCurrentUser) */
export function ownerLabel(addedBy: string): string {
    return addedBy ? `@${addedBy}` : '未知用户'
}

/** 当前用户是否可编辑该资源的共享状态(added_by 为空视为项目创建者资源) */
export function canEditVisibilityOf(workspace: WorkspaceDetail, addedBy: string | undefined, userId: string): boolean {
    const owner = String(addedBy || workspace.owner_username || '').trim()

    return owner === userId
}

/**
 * 对话行是否可打开(对齐原版 canOpenConversation):
 * 自己添加的对话直接打开;他人添加的仅共享态可只读打开。
 */
export function canOpenConversation(workspace: WorkspaceDetail, item: WorkspaceConversation, userId: string): boolean {
    return canEditVisibilityOf(workspace, item.added_by, userId) || normalizeVisibility(item.visibility) === 'share'
}

/** 对话资源 ref */
export function conversationRef(item: WorkspaceConversation): WorkspaceResourceRef {
    return {
        type: 'conversation',
        ref: item.conversation_id,
        addedBy: String(item.added_by || ''),
        visibility: normalizeVisibility(item.visibility),
    }
}

/** 知识库资源 ref(knowledge_type 恒为 basis 体系) */
export function knowledgeRef(item: WorkspaceKnowledgeDocument): WorkspaceResourceRef {
    return {
        type: 'knowledge',
        ref: item.title,
        addedBy: String(item.added_by || ''),
        visibility: normalizeVisibility(item.visibility),
        knowledgeType: String(item.knowledge_type || 'basis'),
    }
}

/** 文件资源 ref */
export function fileRef(item: WorkspaceFileEntry): WorkspaceResourceRef {
    return {
        type: 'file',
        ref: item.file_ref,
        addedBy: String(item.added_by || ''),
        visibility: normalizeVisibility(item.visibility),
    }
}

/** 资源行唯一键(可见性保存中状态按此定位单个开关) */
export function resourceRowKey(target: WorkspaceResourceRef): string {
    return `${target.type}:${target.ref}:${target.addedBy}`
}

/** 右键目标是否落在可见性开关上(开关区域不弹置顶菜单,对齐原版 data-workspace-visibility-toggle 排除) */
export function isVisibilitySwitchTarget(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest('.ws-visibility-switch'))
}

/** 项目文件条目 → 文件中心工具函数所需形状(仅取其读取的字段;预览弹窗与文件面板共用) */
export function toCloudFileItem(entry: WorkspaceFileEntry): CloudFileItem {
    return {
        alias: String(entry.alias || ''),
        original_name: String(entry.original_name || ''),
        title: String(entry.title || ''),
        source_ext: String(entry.source_ext || ''),
    }
}
