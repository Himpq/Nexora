<!--
    WorkspaceMemoryPanel.vue — Workspace 记忆面板

    记忆 Markdown 正文;enabled=false 或无内容显示空态。对齐原版 renderWorkspaceMemoryPanel。
-->

<template>
    <div class="ws-memory">
        <div v-if="!content" class="ws-memory-empty">暂无 Workspace 记忆</div>
        <MarkdownView v-else class="ws-memory-markdown" :content="content" />
    </div>
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    import type { WorkspaceDetail } from '@/api/workspaces'

    import MarkdownView from '@/components/MarkdownView.vue'

    const props = defineProps<{
        workspace: WorkspaceDetail
    }>()

    /** 记忆正文:开关关闭视为无记忆(对齐原版 getWorkspaceMemoryContent) */
    const content = computed(() => {
        const memory = props.workspace.workspace_memory

        if (memory && typeof memory === 'object' && memory.enabled !== false) {
            return String(memory.content || '').trim()
        }

        return ''
    })
</script>

<style scoped>
    .ws-memory {
        padding: 2px 10px 32px;
        color: var(--color-text-primary);
        font-size: 14px;
        line-height: 1.72;
        overflow-wrap: anywhere;
    }

    .ws-memory-empty {
        color: var(--color-text-secondary);
        font-size: 14px;
        padding: 18px 0;
    }
</style>
