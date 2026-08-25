<!--
    WorkspaceList.vue — Workspaces 项目列表视图

    筛选 tabs(全部/由你创建/与你共享)+ 搜索 + 新建;行点击进入详情。
    数据与筛选状态由根组件持有,本组件纯受控。
-->

<template>
    <div class="ws-list-shell">
        <div class="ws-list-head">
            <h1>Workspaces</h1>
            <div class="ws-list-actions">
                <label class="ws-list-search">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <input
                        :value="query"
                        type="search"
                        placeholder="搜索 Workspaces"
                        aria-label="搜索 Workspaces"
                        @input="emit('update:query', ($event.target as HTMLInputElement).value)"
                    >
                </label>
                <Button variant="primary" @click="emit('create')">新建</Button>
            </div>
        </div>

        <div class="ws-list-tabs" role="tablist" aria-label="Workspaces 筛选">
            <button
                v-for="tab in FILTER_TABS"
                :key="tab.value"
                class="ws-list-tab"
                :class="{ active: filter === tab.value }"
                type="button"
                role="tab"
                :aria-selected="filter === tab.value"
                @click="emit('update:filter', tab.value)"
            >{{ tab.label }}</button>
        </div>

        <div class="ws-list-table" role="table" aria-label="Workspaces 列表">
            <div class="ws-list-row ws-list-row-head" role="row">
                <div role="columnheader">名称</div>
                <div role="columnheader">修改时间</div>
            </div>

            <div class="ws-list-body">
                <div v-if="loading" class="ws-empty">加载中...</div>
                <div v-else-if="!workspaces.length" class="ws-empty">暂无 Workspaces</div>

                <button
                    v-for="workspace in workspaces"
                    :key="workspace.workspace_id"
                    class="ws-list-row ws-list-item"
                    type="button"
                    role="row"
                    @click="emit('open', workspace.workspace_id)"
                >
                    <span class="ws-list-name" role="cell">
                        <span class="ws-list-folder">
                            <i class="fa-regular fa-folder" aria-hidden="true"></i>
                        </span>
                        <span>{{ workspace.title || 'Untitled Workspace' }}</span>
                    </span>
                    <span class="ws-list-date" role="cell">{{ formatWorkspaceDate(workspace.updated_at || workspace.created_at) }}</span>
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import type { WorkspaceSummary } from '@/api/workspaces'
    import { formatWorkspaceDate } from '@/api/workspaces'

    import Button from '@/ui/Button.vue'

    defineProps<{
        workspaces: WorkspaceSummary[]
        loading: boolean
        query: string
        filter: 'all' | 'owned' | 'shared'
    }>()

    const emit = defineEmits<{
        'update:query': [value: string]
        'update:filter': [value: 'all' | 'owned' | 'shared']
        create: []
        open: [workspaceId: string]
    }>()

    const FILTER_TABS = [
        { value: 'all', label: '全部' },
        { value: 'owned', label: '由你创建' },
        { value: 'shared', label: '与你共享' },
    ] as const
</script>

<style scoped>
    .ws-list-shell {
        width: 100%;
        max-width: var(--input-container-max-width, 800px);
        min-height: 100%;
        margin: 0 auto;
        padding: 0;
        box-sizing: border-box;
    }

    .ws-list-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 38px;
    }

    .ws-list-head h1 {
        margin: 0;
        font-size: 28px;
        font-weight: 650;
        line-height: 1.2;
        color: var(--color-text-primary);
    }

    .ws-list-actions {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .ws-list-search {
        width: 320px;
        height: 40px;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        background: var(--color-bg-sunken);
        color: var(--color-text-secondary);
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 14px;
    }

    .ws-list-search i {
        color: var(--color-text-secondary);
        font-size: 14px;
    }

    .ws-list-search input {
        width: 100%;
        min-width: 0;
        border: none;
        outline: none;
        background: transparent;
        color: var(--color-text-primary);
        font-size: 14px;
        font-weight: 400;
    }

    .ws-list-search input::placeholder {
        color: var(--color-text-secondary);
        opacity: 1;
    }

    .ws-list-tabs {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 30px;
    }

    .ws-list-tab {
        height: 34px;
        border: none;
        border-radius: 999px;
        background: transparent;
        color: var(--color-text-secondary);
        padding: 0 14px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
    }

    .ws-list-tab.active {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
        box-shadow: inset 0 0 0 1px var(--color-border);
    }

    .ws-list-table {
        width: 100%;
    }

    .ws-list-row {
        width: 100%;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 180px;
        align-items: center;
        gap: 24px;
    }

    .ws-list-row-head {
        color: var(--color-text-secondary);
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 18px;
    }

    .ws-list-item {
        height: 52px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: var(--color-text-primary);
        padding: 0 10px;
        text-align: left;
        cursor: pointer;
    }

    .ws-list-item:hover {
        background: var(--color-bg-hover);
    }

    .ws-list-body {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .ws-list-name {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        font-size: 15px;
        font-weight: 600;
    }

    .ws-list-folder {
        width: 36px;
        height: 36px;
        border-radius: 8px;
        border: 1px solid var(--color-border);
        background: var(--color-bg-sunken);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
    }

    .ws-list-folder i {
        color: var(--color-text-secondary);
        font-size: 18px;
    }

    .ws-list-date {
        color: var(--color-text-secondary);
        font-size: 14px;
        font-weight: 400;
    }

    @media (max-width: 1180px) {
        .ws-list-head {
            align-items: flex-start;
            flex-direction: column;
            margin-bottom: 32px;
        }

        .ws-list-actions {
            width: 100%;
        }

        .ws-list-search {
            flex: 1;
            width: auto;
        }
    }

    @media (max-width: 720px) {
        .ws-list-head h1 {
            font-size: 24px;
        }

        .ws-list-search {
            height: 38px;
            padding: 0 12px;
        }

        .ws-list-search input,
        .ws-list-tab,
        .ws-list-row-head,
        .ws-list-name,
        .ws-list-date {
            font-size: 13px;
        }

        .ws-list-tabs {
            gap: 8px;
            margin-bottom: 24px;
        }

        .ws-list-tab {
            height: 32px;
            padding: 0 12px;
        }

        .ws-list-row {
            grid-template-columns: minmax(0, 1fr) 96px;
            gap: 16px;
        }

        .ws-list-folder {
            width: 34px;
            height: 34px;
        }

        .ws-list-folder i {
            font-size: 17px;
        }
    }
</style>
