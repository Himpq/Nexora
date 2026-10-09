<template>
    <div
        class="conversation-item"
        :class="{
            active,
            'is-streaming': streaming,
            'conversation-branch-item': isVisibleBranch,
            'nexoracode-project-conversation-item': projectItem,
        }"
        :data-conversation-id="conversation.id"
        :data-pin="isPinned ? '1' : '0'"
        :style="rowStyle"
        :title="branchTooltip"
        @click="emit('open')"
        @contextmenu.prevent="emit('contextmenu', $event)"
    >
        <span class="title" :title="conversation.title">
            <i
                v-if="isVisibleBranch"
                class="fa-solid fa-code-branch conversation-branch-icon"
                aria-hidden="true"
            ></i>
            <i
                v-if="isPinned"
                class="fa-solid fa-thumbtack conversation-pin-icon"
                aria-hidden="true"
            ></i>
            {{ conversation.title }}
        </span>
        <span class="conversation-item-right">
            <button
                class="btn-icon-small delete-chat"
                type="button"
                title="删除会话"
                aria-label="删除会话"
                @click.stop="emit('delete')"
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
            <span
                v-if="streaming"
                class="conversation-stream-indicator is-loading"
                title="模型正在回复"
                aria-hidden="true"
            >
                <i class="fa-solid fa-circle-notch fa-spin"></i>
            </span>
        </span>
    </div>
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    import type { ConversationSummary } from '@/api/conversations'

    const props = withDefaults(defineProps<{
        conversation: ConversationSummary
        depth?: number
        orphan?: boolean
        active?: boolean
        streaming?: boolean
        projectItem?: boolean
    }>(), {
        depth: 0,
        orphan: false,
        active: false,
        streaming: false,
        projectItem: false,
    })

    const emit = defineEmits<{
        open: []
        delete: []
        contextmenu: [event: MouseEvent]
    }>()

    const branch = computed(() => props.conversation.branch)
    const isPinned = computed(() => !!props.conversation.pin)
    const isVisibleBranch = computed(() => !!branch.value && !props.orphan)
    const branchTooltip = computed(() => {
        if (!isVisibleBranch.value || !branch.value) {
            return undefined
        }

        return `分支自会话 ${branch.value.parent_conversation_id} 的第 ${branch.value.parent_message_index + 1} 条消息`
    })
    const rowStyle = computed(() => {
        if (!isVisibleBranch.value) {
            return undefined
        }

        return {
            '--conversation-branch-offset': `${Math.max(1, props.depth) * 14}px`,
        }
    })
</script>
