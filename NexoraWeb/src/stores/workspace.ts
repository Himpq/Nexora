/**
 * workspace.ts — Workspace 归入数据变更信号(模块级单例)
 *
 * 职责:
 *   - 右键菜单等 WorkspacesView 外部入口完成归入/取消归入后广播一次失效
 *   - 打开中的 WorkspacesView 订阅信号,立即重拉列表与详情,消除"归入后页面不刷新"
 *
 * 说明:
 *   归入动作分散在会话/知识库/文件多处右键菜单里,而 WorkspacesView 与它们
 *   无父子关系,故用轻量信号而非组件事件链传递变更。
 */

import { reactive } from 'vue'

/** Workspace 变更信号(响应式单例) */
export const workspaceChanges = reactive({
    /** 每次归入 / 取消归入成功后自增 */
    count: 0,
})

/** 广播一次 Workspace 归入变更 */
export function notifyWorkspaceChanged(): void {
    workspaceChanges.count += 1
}

/**
 * 会话 → 所属 Workspace 的会话级缓存:
 *   - 记录时机仅限前端确知归属的两处:Workspace 详情内新建发送、从 Workspace
 *     面板打开自己的会话(他人共享只读会话不记录,后端本就拒绝其继续生成)
 *   - 消费时机为发送/重答携带 workspace_id,让后端注入 Workspace 上下文与
 *     记忆/草稿工具;刷新页面后缓存清空,从侧栏直接打开的会话不携带 workspace_id
 */
const conversationWorkspaces: Record<string, string> = {}

/** 记录会话与 Workspace 的归属(后者覆盖前者) */
export function setConversationWorkspace(conversationId: string, workspaceId: string): void {
    const cid = String(conversationId || '').trim()
    const wid = String(workspaceId || '').trim()

    if (cid && wid) {
        conversationWorkspaces[cid] = wid
    }
}

/** 读取会话所属 Workspace id(未记录返回空串) */
export function getConversationWorkspace(conversationId: string): string {
    return conversationWorkspaces[String(conversationId || '').trim()] || ''
}
