import { computed } from 'vue'

import { useConversationStore } from '@/stores/conversation'
import type { ToolStageReplySource } from '@/ui/toolStage'

/** 复用当前会话的流状态与助手对象,输出分段增量仅驱动预览组件,不重新渲染聊天外壳。 */
export function useCurrentToolStageReply() {
    const conversation = useConversationStore()

    return computed<ToolStageReplySource | null>(() => {

        if (!conversation.currentConversationGenerating) {
            return null
        }

        return conversation.pendingStreams[conversation.currentId]!.assistant
    })
}
