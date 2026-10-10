/**
 * localTaskWatcher.ts — 本地任务事件监听（NexoraCode 桌面端专用）
 *
 * 背景：云端通过 RemoteControl 下发的任务，在本地前端没有流句柄、没有快照，
 * 因此本地 UI 完全感知不到该会话正在跑。本模块订阅本地任务事件流
 * （/api/local/tasks/watch），把「电脑上正在运行哪些会话」同步进 store：
 *   - task_started  → store.markConversationRunning，侧栏标运行状态；
 *   - task_finished → store.clearConversationRunning，清除标记。
 *
 * 职责边界：本模块只负责「发现 + 标记 + 记录任务信息」，不建立流、不读事件。
 * 真正的流接管（chatStream.resume + 渲染）由宿主在用户打开该会话时触发，
 * 通过 registerTaskStartedHandler 注册的回调完成——这样 handlers 复用宿主
 * 已有的 createStreamHandlers，不必在本模块重复实现事件分发。
 */

import { subscribeLocalTaskEvents, type LocalTaskEvent } from '@/api/nexoracodeLocal'
import { useConversationStore } from '@/stores/conversation'

/** 运行中任务的关键信息，供宿主接管时使用。 */
export interface RunningTaskInfo {
    conversationId: string
    streamId: string
    /** 本轮请求正文；空串表示内部任务（如权限续跑）或重答。 */
    message: string
    /** 权限续跑这类内部任务不落盘用户消息，接管时不要补气泡。 */
    skipUserMessage: boolean
    isRegenerate: boolean
    /** 任务启动时该会话已有的用户消息数；用于判断请求正文是否已随历史加载。 */
    historyUserCount: number | null
}

/** 宿主注册的接管回调：当某会话开始运行、且需要接管时调用。 */
type TaskStartedHandler = (info: RunningTaskInfo) => void

let unsubscribe: (() => void) | null = null
let taskStartedHandler: TaskStartedHandler | null = null

/**
 * 会话 → 运行中任务信息映射。
 *
 * 侧栏转圈只需要会话 id，但用户打开会话要接管时必须有 stream_id 与请求正文，
 * 因此这里保留完整信息；集合语义由 store.runningConversations 承载。
 */
const runningTasks = new Map<string, RunningTaskInfo>()

/**
 * 注册「会话开始运行」回调。
 *
 * 宿主（ChatView）用它在用户正打开该会话时接管流。回调只对当前会话生效——
 * 是否接管由宿主判断（比较 store.currentId），本模块不替宿主决定。
 */
export function registerTaskStartedHandler(handler: TaskStartedHandler | null): void {
    taskStartedHandler = handler
}

/** 读取某会话当前运行中的任务信息；无运行任务返回 null。 */
export function getRunningTask(conversationId: string): RunningTaskInfo | null {
    return runningTasks.get(conversationId) || null
}

function handleEvent(event: LocalTaskEvent): void {
    const conversationId = String(event.conversation_id || '').trim()

    if (!conversationId) {
        return
    }

    const store = useConversationStore()

    if (event.type === 'task_started') {
        const info: RunningTaskInfo = {
            conversationId,
            streamId: String(event.stream_id || '').trim(),
            message: String(event.message || '').trim(),
            skipUserMessage: event.skip_user_message === true,
            isRegenerate: event.is_regenerate === true,
            historyUserCount: typeof event.history_user_count === 'number' ? event.history_user_count : null,
        }

        runningTasks.set(conversationId, info)
        store.markConversationRunning(conversationId)
        // 交给宿主决定是否接管（通常只看当前打开的会话）。
        taskStartedHandler?.(info)

        return
    }

    if (event.type === 'task_finished') {
        runningTasks.delete(conversationId)
        store.clearConversationRunning(conversationId)
    }
}

/** 启动本地任务事件监听；重复调用无副作用。 */
export function startLocalTaskWatcher(): void {
    if (unsubscribe) {
        return
    }

    unsubscribe = subscribeLocalTaskEvents(handleEvent, (error) => {
        console.warn('[LocalTaskWatcher] 任务事件流中断:', error.message)
    })
}

/** 停止监听（组件卸载时调用）。 */
export function stopLocalTaskWatcher(): void {
    unsubscribe?.()
    unsubscribe = null
    runningTasks.clear()
}
