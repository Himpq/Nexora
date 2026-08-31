<template>
    <!-- 空变更不渲染，避免历史迁移产生的无内容 banner 间歇出现 -->
    <div v-if="changes.length" class="conversation-knowledge-event" :data-scope="event.scope">
        <div class="conversation-knowledge-event-head">
            <i class="fa-solid fa-database" aria-hidden="true"></i>
            <span>知识状态变更</span>
            <span class="conversation-knowledge-event-scope">{{ scopeLabel }}</span>
        </div>

        <div class="conversation-knowledge-event-changes">
            <div v-for="change in changes" :key="`${change.kind}-${change.title}`" class="conversation-knowledge-event-change" :class="change.kind">
                <span class="conversation-knowledge-event-sign" aria-hidden="true">{{ change.kind === 'added' ? '+' : '-' }}</span>
                <span>{{ change.title }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    import type { ConversationContextEvent } from '@/api/conversations'

    const props = defineProps<{ event: ConversationContextEvent }>()

    const scopeLabel = computed(() => props.event.scope === 'workspace' ? 'Workspace' : '全局知识库')

    const changes = computed(() => {
        const rows: Array<{ kind: 'added' | 'removed'; title: string }> = []

        for (const kind of ['added', 'removed'] as const) {
            const items = Array.isArray(props.event[kind]) ? props.event[kind] : []

            for (const item of items) {
                const title = typeof item === 'string'
                    ? item.trim()
                    : String(item && typeof item === 'object' ? (item.title || item.name || '') : '').trim()

                if (title) {
                    rows.push({ kind, title })
                }
            }
        }

        return rows
    })


</script>

<style scoped>
    .conversation-knowledge-event {
        width: min(680px, 100%);
        margin: 14px auto;
        padding: 10px 14px;
        border-left: 2px solid var(--accent-color, #6b7280);
        color: var(--text-secondary, #6b7280);
        background: color-mix(in srgb, var(--surface-muted, #f4f4f5) 82%, transparent);
        font-size: 12px;
    }

    .conversation-knowledge-event-head {
        display: flex;
        align-items: center;
        gap: 7px;
        color: var(--text-primary, #374151);
        font-weight: 600;
    }

    .conversation-knowledge-event-scope {
        color: var(--text-tertiary, #9ca3af);
        font-weight: 400;
    }

    .conversation-knowledge-event-changes {
        display: grid;
        gap: 3px;
        margin-top: 7px;
    }

    .conversation-knowledge-event-change {
        display: flex;
        gap: 7px;
        line-height: 1.45;
    }

    .conversation-knowledge-event-change.added {
        color: #15803d;
    }

    .conversation-knowledge-event-change.removed {
        color: #b91c1c;
    }

    .conversation-knowledge-event-sign {
        width: 10px;
        flex: 0 0 10px;
        font-weight: 700;
        text-align: center;
    }

    .conversation-knowledge-event-empty {
        margin-top: 6px;
        color: var(--text-tertiary, #9ca3af);
    }
</style>
