<!--
    WorkspaceConversationsPanel.vue — Workspace 聊天(对话)面板

    置顶优先排序;标题 + "@添加者 · 最近提问";日期 + 可见性开关。
    行权限对齐原版:自己添加的行可打开;他人添加的仅共享态可只读打开,
    私有他人行降级为不可点列表项(is-readonly)。
-->

<template>
    <div class="ws-conv-list">
        <div v-if="!conversations.length" class="ws-empty">暂无已加入的对话</div>

        <div
            v-for="conv in conversations"
            :key="conv.conversation_id"
            class="ws-conv-row"
            :class="{ 'is-clickable': canOpen(conv), 'is-readonly': !canEdit(conv), 'is-pinned': conv.pin }"
            :role="canOpen(conv) ? 'button' : 'listitem'"
            :tabindex="canOpen(conv) ? 0 : -1"
            :aria-label="rowAriaLabel(conv)"
            :aria-disabled="canOpen(conv) ? undefined : 'true'"
            @click="canOpen(conv) && open(conv)"
            @keydown.enter.prevent="canOpen(conv) && open(conv)"
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
                    :disabled="!canEdit(conv)"
                    :saving="savingKey === rowKey(conv)"
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

    import {
        canEditVisibilityOf,
        canOpenConversation,
        conversationRef,
        isVisibilitySwitchTarget,
        ownerLabel,
        resourceRowKey,
    } from '../workspaceResource'
    import { sortPinnedFirst } from '../workspaceDisplay'
    import { useVisibilitySavingKey, useWorkspaceActions } from '../workspaceContext'

    import WorkspaceVisibilitySwitch from '../WorkspaceVisibilitySwitch.vue'

    const props = defineProps<{
        workspace: WorkspaceDetail
    }>()

    const actions = useWorkspaceActions()
    const savingKey = useVisibilitySavingKey()

    const conversations = computed<WorkspaceConversation[]>(() => {
        const items = Array.isArray(props.workspace.conversations) ? props.workspace.conversations : []

        return sortPinnedFirst(items, (item) => item.pin === true)
    })

    /** 是否当前用户添加(可见性开关可用性) */
    function canEdit(item: WorkspaceConversation): boolean {
        return canEditVisibilityOf(props.workspace, item.added_by, actions.currentUserId())
    }

    /** 行是否可打开:自己的行直接开,他人的行仅共享态可只读开(对齐原版 canOpenConversation) */
    function canOpen(item: WorkspaceConversation): boolean {
        return canOpenConversation(props.workspace, item, actions.currentUserId())
    }

    /** 无障碍文案:区分 打开 / 只读共享打开 / 不可打开 */
    function rowAriaLabel(item: WorkspaceConversation): string {
        const title = item.title || item.conversation_id || '未命名对话'

        if (!canOpen(item)) {
            return `共享对话:${title}`
        }

        return `${canEdit(item) ? '打开对话' : '只读打开共享对话'}:${title}`
    }

    /** 副标题:@添加者 · 最近用户提问 */
    function detailText(item: WorkspaceConversation): string {
        return `${ownerLabel(String(item.added_by || ''))} · ${String(item.last_user_question || '暂无用户提问').trim()}`
    }

    function rowKey(item: WorkspaceConversation): string {
        return resourceRowKey(conversationRef(item))
    }

    function open(item: WorkspaceConversation): void {
        actions.openConversation(item.conversation_id, String(item.added_by || ''))
    }

    function toggleVisibility(item: WorkspaceConversation): void {
        const target = conversationRef(item)
        const next = target.visibility === 'share' ? 'private' : 'share'

        void actions.toggleResourceVisibility(target, next)
    }

    /** 开关区域右键不弹置顶菜单(对齐原版 visibility-toggle 排除) */
    function openMenu(event: MouseEvent, item: WorkspaceConversation): void {
        if (isVisibilitySwitchTarget(event.target)) {
            return
        }

        actions.openResourceMenu(event, conversationRef(item))
    }
</script>

<style scoped>
    .ws-conv-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .ws-conv-row {
        width: 100%;
        height: 60px;
        border-radius: 8px;
        background: transparent;
        color: var(--color-text-primary);
        display: grid;
        grid-template-columns: minmax(0, 1fr) 218px;
        align-items: center;
        gap: 24px;
        padding: 10px 12px;
        transition: background 0.16s ease, color 0.16s ease;
    }

    .ws-conv-row.is-clickable {
        cursor: pointer;
    }

    .ws-conv-row.is-clickable:hover {
        background: var(--color-bg-hover);
    }

    /* 只读行(他人私有资源):保留展示但弱化悬停反馈 */
    .ws-conv-row.is-readonly.is-clickable:hover {
        background: var(--color-bg-sunken);
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

    .ws-conv-main small {
        color: var(--color-text-secondary);
        font-size: 12px;
        line-height: 1.35;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
        }

        .ws-conv-main strong {
            font-size: 14px;
        }
    }
</style>
