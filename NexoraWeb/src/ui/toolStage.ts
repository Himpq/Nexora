import type { MessageSegment } from '@/stream/messageSegments'

export const TOOL_STAGE_OPEN_EVENT = 'nexora:tool-stage-open'
export const TOOL_STAGE_RESIZE_EVENT = 'nexora:tool-stage-resize'

/** 通用预览消费当前回复的有序输出分段,不依赖地图或具体会话存储。 */
export interface ToolStageReplySource {
    segments?: readonly MessageSegment[]
}

export interface ToolStageOpenRequest {
    element: HTMLElement
    title: string
    controlsTarget: HTMLElement
    trigger?: HTMLElement
}

/** Open any connected tool element in the reusable chat-stage focus layer. */
export function requestToolStageOpen(element: HTMLElement, title: string, controlsTarget: HTMLElement, trigger?: HTMLElement): void {
    window.dispatchEvent(new CustomEvent<ToolStageOpenRequest>(TOOL_STAGE_OPEN_EVENT, {
        detail: { element, title, controlsTarget, trigger },
    }))
}

/** Notify embedded tools that their visible container has changed size. */
export function notifyToolStageResize(element: HTMLElement): void {
    element.dispatchEvent(new CustomEvent(TOOL_STAGE_RESIZE_EVENT, { bubbles: true }))
}
