<!--
    WorkspaceKnowledgePanel.vue — Workspace 知识库面板

    置顶优先排序行:图标 + 标题 + @添加者;日期 + 可见性开关;
    点击打开知识库文档,右键弹出置顶菜单。对齐原版 renderWorkspaceProjectKnowledgeRows。
-->

<template>
    <div class="ws-knowledge-list">
        <div v-if="!documents.length" class="ws-empty">暂无知识库内容</div>

        <div
            v-for="doc in documents"
            :key="knowledgeKey(doc)"
            class="ws-knowledge-row is-clickable"
            :class="{ 'is-pinned': doc.pin }"
            role="button"
            tabindex="0"
            :aria-label="`打开知识库:${doc.title}`"
            @click="actions.openKnowledge(doc.title)"
            @keydown.enter.prevent="actions.openKnowledge(doc.title)"
            @contextmenu.prevent="openMenu($event, doc)"
        >
            <span class="ws-knowledge-icon"><i class="fa-solid fa-database" aria-hidden="true"></i></span>
            <span class="ws-knowledge-main">
                <span class="ws-knowledge-title">
                    <i v-if="doc.pin" class="fa-solid fa-thumbtack ws-pin-icon" aria-hidden="true"></i>{{ doc.title }}
                </span>
                <span class="ws-knowledge-meta">{{ doc.added_by ? `@${doc.added_by}` : '未知用户' }}</span>
            </span>
            <span class="ws-row-side">
                <span class="ws-row-date">{{ formatWorkspaceDate(doc.updated_at || doc.added_at || doc.created_at) }}</span>
                <WorkspaceVisibilitySwitch
                    :visibility="String(doc.visibility || '')"
                    :disabled="!canEditVisibility(doc)"
                    @toggle="toggleVisibility(doc)"
                />
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    import type { WorkspaceDetail, WorkspaceKnowledgeDocument } from '@/api/workspaces'
    import { formatWorkspaceDate } from '@/api/workspaces'

    import { normalizeVisibility, sortPinnedFirst } from '../workspaceDisplay'
    import { useWorkspaceActions, type WorkspaceResourceRef } from '../workspaceContext'

    import WorkspaceVisibilitySwitch from '../WorkspaceVisibilitySwitch.vue'

    const props = defineProps<{
        workspace: WorkspaceDetail
    }>()

    const actions = useWorkspaceActions()

    const documents = computed<WorkspaceKnowledgeDocument[]>(() => {
        const items = Array.isArray(props.workspace.knowledge_documents) ? props.workspace.knowledge_documents : []

        return sortPinnedFirst(items, (item) => item.pin === true)
    })

    function knowledgeKey(doc: WorkspaceKnowledgeDocument): string {
        return `${doc.title}:${String(doc.added_by || '')}`
    }

    function canEditVisibility(item: WorkspaceKnowledgeDocument): boolean {
        const owner = String(item.added_by || props.workspace.owner_username || '').trim()

        return owner === actions.currentUserId()
    }

    function resourceRef(item: WorkspaceKnowledgeDocument): WorkspaceResourceRef {
        return {
            type: 'knowledge',
            ref: item.title,
            addedBy: String(item.added_by || ''),
            visibility: normalizeVisibility(item.visibility),
            knowledgeType: String(item.knowledge_type || 'basis'),
        }
    }

    function toggleVisibility(item: WorkspaceKnowledgeDocument): void {
        const next = normalizeVisibility(item.visibility) === 'share' ? 'private' : 'share'

        void actions.toggleResourceVisibility(resourceRef(item), next)
    }

    function openMenu(event: MouseEvent, item: WorkspaceKnowledgeDocument): void {
        actions.openResourceMenu(event, resourceRef(item))
    }
</script>

<style scoped>
    .ws-knowledge-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .ws-empty {
        color: var(--color-text-secondary);
        font-size: 14px;
        padding: 18px 10px;
    }

    .ws-knowledge-row {
        width: 100%;
        min-height: 60px;
        border-radius: 8px;
        background: transparent;
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr) 218px;
        align-items: center;
        gap: 10px 14px;
        padding: 10px 12px;
        box-sizing: border-box;
    }

    .ws-knowledge-row.is-clickable {
        cursor: pointer;
    }

    .ws-knowledge-row:hover {
        background: var(--color-bg-hover);
    }

    .ws-knowledge-row:focus-visible {
        outline: 2px solid var(--color-accent-text);
        outline-offset: 2px;
    }

    .ws-knowledge-icon {
        width: 30px;
        height: 30px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-sunken);
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
    }

    .ws-knowledge-main {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .ws-pin-icon {
        color: var(--color-text-primary);
        font-size: 11px;
        margin-right: 7px;
    }

    .ws-knowledge-title {
        min-width: 0;
        color: var(--color-text-primary);
        font-size: 14px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ws-knowledge-meta {
        min-width: 0;
        color: var(--color-text-secondary);
        font-size: 12px;
        line-height: 1.3;
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
        .ws-knowledge-row {
            grid-template-columns: 30px minmax(0, 1fr);
        }

        .ws-row-side {
            grid-column: 2;
            justify-content: flex-start;
            width: 100%;
        }

        .ws-row-date {
            text-align: left;
            font-size: 12px;
        }

        .ws-knowledge-title {
            font-size: 14px;
        }
    }
</style>
