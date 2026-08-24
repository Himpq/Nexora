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
