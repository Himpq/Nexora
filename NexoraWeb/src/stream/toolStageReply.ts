import { computed } from 'vue'

import { useConversationStore } from '@/stores/conversation'
import type { ToolStageReplySource } from '@/ui/toolStage'

/** 读取当前会话保留的助手回复,并在流结束后继续提供最终正文预览。 */
export function useCurrentToolStageReply() {
    const conversation = useConversationStore()

    return computed<ToolStageReplySource | null>(() => {
        const pending = conversation.currentId
            ? conversation.pendingStreams[conversation.currentId]
            : undefined

        if (!pending) {
            return null
        }

        return {
            segments: pending.assistant.segments,
            completed: pending.finished,
        }
    })
}
