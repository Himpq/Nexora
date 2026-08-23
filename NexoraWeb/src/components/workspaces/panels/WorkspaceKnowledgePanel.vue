<!--
    WorkspaceKnowledgePanel.vue — Workspace 知识库面板

    置顶优先排序行:图标 + 标题 + @添加者;日期 + 可见性开关;
    点击打开知识库文档,右键弹出置顶菜单(开关区域除外)。
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
                    <i v-if="doc.pin" class="fa-solid fa-thumbtack ws-pin-icon" aria-hidden="true"></i>{{ knowledgeTitle(doc) }}
                </span>
                <span class="ws-knowledge-meta">{{ ownerLabel(String(doc.added_by || '')) }}</span>
            </span>
            <span class="ws-row-side">
                <span class="ws-row-date">{{ formatWorkspaceDate(doc.updated_at || doc.added_at || doc.created_at) }}</span>
                <WorkspaceVisibilitySwitch
                    :visibility="String(doc.visibility || '')"
                    :disabled="!canEdit(doc)"
                    :saving="savingKey === rowKey(doc)"
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

    import {
        canEditVisibilityOf,
        isVisibilitySwitchTarget,
        knowledgeRef,
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

    const documents = computed<WorkspaceKnowledgeDocument[]>(() => {
        const items = Array.isArray(props.workspace.knowledge_documents) ? props.workspace.knowledge_documents : []

        return sortPinnedFirst(items, (item) => item.pin === true)
    })

    function knowledgeKey(doc: WorkspaceKnowledgeDocument): string {
        return `${doc.title}:${String(doc.added_by || '')}`
    }

    /** 知识库标题:后端偶发把原始 epoch 塞进 title,纯数字时回落为「未命名知识库」 */
    function knowledgeTitle(doc: WorkspaceKnowledgeDocument): string {
        const title = String(doc.title || '').trim()

        if (!title || /^[\d.]+$/.test(title)) {
            return '未命名知识库'
        }

        return title
    }

    function canEdit(item: WorkspaceKnowledgeDocument): boolean {
        return canEditVisibilityOf(props.workspace, item.added_by, actions.currentUserId())
    }

    function rowKey(item: WorkspaceKnowledgeDocument): string {
        return resourceRowKey(knowledgeRef(item))
    }

    function toggleVisibility(item: WorkspaceKnowledgeDocument): void {
        const target = knowledgeRef(item)
        const next = target.visibility === 'share' ? 'private' : 'share'

        void actions.toggleResourceVisibility(target, next)
    }

    /** 开关区域右键不弹置顶菜单(对齐原版 visibility-toggle 排除) */
    function openMenu(event: MouseEvent, item: WorkspaceKnowledgeDocument): void {
        if (isVisibilitySwitchTarget(event.target)) {
            return
        }

        actions.openResourceMenu(event, knowledgeRef(item))
    }
</script>

<style scoped>
    .ws-knowledge-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
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
        }
    }
</style>
