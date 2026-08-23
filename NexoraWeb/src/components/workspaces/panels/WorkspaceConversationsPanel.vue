<!--
    WorkspaceConversationsPanel.vue — Workspace 聊天(对话)面板

    置顶优先排序;标题 + "@添加者 · 最近提问";日期 + 可见性开关;
    点击打开会话,右键弹出置顶菜单。对齐原版 renderWorkspaceProjectConversationRows。
-->

<template>
    <div class="ws-conv-list">
        <div v-if="!conversations.length" class="ws-empty">暂无已加入的对话</div>

        <div
            v-for="conv in conversations"
            :key="conv.conversation_id"
            class="ws-conv-row is-clickable"
            :class="{ 'is-pinned': conv.pin }"
            role="button"
            tabindex="0"
            :aria-label="`打开对话:${conv.title || conv.conversation_id}`"
            @click="open(conv)"
            @keydown.enter.prevent="open(conv)"
            @contextmenu.prevent="openMenu($event, conv)"
        >
            <span class="ws-conv-main">
                <strong>
                    <i v-if="conv.pin" class="fa-solid fa-thumbtack ws-pin-icon" aria-hidden="true"></i>{{ conv.title || conv.conversation_id }}
                </strong>
                <small>{{ detailText(conv) }}</small>
            </span>
            <span class="ws-row-side">
                <span class="ws-row-date">{{ formatWorkspaceDate(conv.updated_at || conv.added_at || conv.created_at) }}</span>
                <WorkspaceVisibilitySwitch
                    :visibility="String(conv.visibility || '')"
                    :disabled="!canEditVisibility(conv)"
                    @toggle="toggleVisibility(conv)"
                />
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    import type { WorkspaceConversation, WorkspaceDetail } from '@/api/workspaces'
    import { formatWorkspaceDate } from '@/api/workspaces'

    import { normalizeVisibility, sortPinnedFirst } from '../workspaceDisplay'
    import { useWorkspaceActions, type WorkspaceResourceRef } from '../workspaceContext'

    import WorkspaceVisibilitySwitch from '../WorkspaceVisibilitySwitch.vue'

    const props = defineProps<{
        workspace: WorkspaceDetail
    }>()

    const actions = useWorkspaceActions()

    const conversations = computed<WorkspaceConversation[]>(() => {
        const items = Array.isArray(props.workspace.conversations) ? props.workspace.conversations : []

        return sortPinnedFirst(items, (item) => item.pin === true)
    })

    /** 资源是否当前用户添加(可见性开关可用性;空 added_by 视为项目创建者资源) */
    function canEditVisibility(item: WorkspaceConversation): boolean {
        const owner = String(item.added_by || props.workspace.owner_username || '').trim()

        return owner === actions.currentUserId()
    }

    /** 副标题:@添加者 · 最近用户提问 */
    function detailText(item: WorkspaceConversation): string {
        const owner = String(item.added_by || '').trim()
        const lastQuestion = String(item.last_user_question || '暂无用户提问').trim()

        return `${owner ? `@${owner}` : '未知用户'} · ${lastQuestion}`
    }

    function resourceRef(item: WorkspaceConversation): WorkspaceResourceRef {
        return {
            type: 'conversation',
            ref: item.conversation_id,
            addedBy: String(item.added_by || ''),
            visibility: normalizeVisibility(item.visibility),
        }
    }

    function open(item: WorkspaceConversation): void {
        actions.openConversation(item.conversation_id)
    }

    function toggleVisibility(item: WorkspaceConversation): void {
        const next = normalizeVisibility(item.visibility) === 'share' ? 'private' : 'share'

        void actions.toggleResourceVisibility(resourceRef(item), next)
    }

    function openMenu(event: MouseEvent, item: WorkspaceConversation): void {
        actions.openResourceMenu(event, resourceRef(item))
    }
</script>

<style scoped>
    .ws-conv-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .ws-empty {
        color: var(--color-text-secondary);
        font-size: 14px;
        padding: 18px 10px;
    }

    .ws-conv-row {
        width: 100%;
        height: 60px;
        border-radius: 8px;
        background: transparent;
        color: var(--color-text-primary);
        cursor: pointer;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 218px;
        align-items: center;
        gap: 24px;
        padding: 10px 12px;
        transition: background 0.16s ease, color 0.16s ease;
    }

    .ws-conv-row:hover {
        background: var(--color-bg-hover);
    }

    .ws-conv-row:focus-visible {
        outline: 2px solid var(--color-accent-text);
        outline-offset: 2px;
    }

    .ws-conv-main {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .ws-conv-main strong {
        color: var(--color-text-primary);
        font-size: 15px;
        font-weight: 650;
        line-height: 1.35;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ws-pin-icon {
        color: var(--color-text-primary);
        font-size: 11px;
        margin-right: 7px;
    }

    .ws-conv-main small {
        color: var(--color-text-secondary);
        font-size: 12px;
        line-height: 1.35;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ws-row-side {
        display: grid;
        grid-template-columns: 92px 112px;
        align-items: center;
        justify-content: flex-end;
        gap: 14px;
    }

    .ws-row-date {
        color: var(--color-text-secondary);
        font-size: 13px;
        text-align: right;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }

    @media (max-width: 720px) {
        .ws-conv-row {
            grid-template-columns: minmax(0, 1fr);
            gap: 14px;
            height: auto;
            min-height: 60px;
        }

        .ws-row-side {
            grid-column: 1;
            justify-content: flex-start;
            width: 100%;
        }

        .ws-row-date {
            text-align: left;
            font-size: 12px;
        }

        .ws-conv-main strong {
            font-size: 14px;
        }
    }
</style>
