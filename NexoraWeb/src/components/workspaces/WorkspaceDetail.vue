<!--
    WorkspaceDetail.vue — Workspace 详情壳

    头部(图标 + 内联改名编辑器 + 分享/删除)+ tab 栏(按 tab 显隐动作按钮)+
    六个面板的挂载与切换。数据编排全部走注入的 WorkspaceActions。
-->

<template>
    <div class="ws-detail-shell">
        <!-- 头部 -->
        <div class="ws-detail-header">
            <div class="ws-detail-title-row">
                <button class="ws-detail-back-btn" type="button" title="返回 Workspaces" aria-label="返回 Workspaces" @click="emit('back')">
                    <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                </button>
                <span class="ws-detail-title-icon">
                    <i class="fa-regular fa-folder" aria-hidden="true"></i>
                </span>
                <span class="ws-detail-title-editor" :class="{ 'is-editing': renaming }">
                    <h1 v-show="!renaming" class="ws-detail-title-text">{{ title }}</h1>
                    <input
                        v-show="renaming"
                        ref="renameInputRef"
                        v-model="renameValue"
                        class="ws-detail-title-input"
                        type="text"
                        aria-label="Workspace 名称"
                        :disabled="renameSaving"
                        @blur="commitRename()"
                        @keydown.enter.prevent="renameInputRef?.blur()"
                        @keydown.esc.prevent="cancelRename"
                    >
                </span>
                <button v-show="!renaming" class="ws-detail-title-edit-btn" type="button" title="修改 Workspace 名称" aria-label="修改 Workspace 名称" @click="startRename">
                    <i class="fa-solid fa-pen" aria-hidden="true"></i>
                </button>
            </div>
            <div class="ws-detail-actions" aria-label="Workspace 操作">
                <button
                    class="ws-detail-action-btn"
                    type="button"
                    :title="canShare ? (sharedCount ? `分享 Workspace,已共享 ${sharedCount} 位用户` : '分享 Workspace') : '只有创建者可以分享 Workspace'"
                    aria-label="分享 Workspace"
                    :disabled="!canShare"
                    @click="actions.openShareModal()"
                >
                    <i class="fa-solid fa-share-nodes" aria-hidden="true"></i>
                </button>
                <button
                    class="ws-detail-action-btn is-danger"
                    type="button"
                    :title="canShare ? '删除 Workspace' : '只有创建者可以删除 Workspace'"
                    aria-label="删除 Workspace"
                    :disabled="!canShare"
                    @click="actions.deleteWorkspace()"
                >
                    <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                </button>
            </div>
        </div>

        <!-- 详情内嵌输入框停靠点:ChatView 的 ChatInput 经 Teleport 挂载于此(对齐原版 workspaceDetailInputSlot) -->
        <div id="ws-detail-input-slot" class="ws-detail-input-slot" aria-label="Workspace 对话输入"></div>

        <!-- tab 栏 -->
        <div class="ws-detail-tabs" role="tablist" aria-label="Workspace 内容">
            <button
                v-for="tab in TABS"
                :key="tab.value"
                class="ws-detail-tab"
                :class="{ active: activeTab === tab.value }"
                type="button"
                role="tab"
                :aria-selected="activeTab === tab.value"
                @click="emit('update:tab', tab.value)"
            ><span>{{ tab.label }}</span></button>

            <button
                v-if="activeTab === 'knowledge'"
                class="ws-detail-side-btn"
                type="button"
                title="新建空白知识库"
                aria-label="新建空白知识库"
                :disabled="creatingKnowledge"
                @click="handleCreateKnowledge"
            >
                <i :class="creatingKnowledge ? 'fa-solid fa-spinner' : 'fa-solid fa-plus'" aria-hidden="true"></i>
                <span>新建</span>
            </button>

            <span v-if="activeTab === 'files'" class="ws-detail-file-actions">
                <button class="ws-detail-side-btn" type="button" title="添加已有云端文件" aria-label="添加已有云端文件" @click="actions.pickCloudFiles()">
                    <i class="fa-solid fa-link" aria-hidden="true"></i>
                    <span>添加</span>
                </button>
                <button class="ws-detail-side-btn" type="button" title="上传文件到 Workspace" aria-label="上传文件到 Workspace" @click="uploadInputRef?.click()">
                    <i class="fa-solid fa-upload" aria-hidden="true"></i>
                    <span>上传</span>
                </button>
                <input
                    ref="uploadInputRef"
                    type="file"
                    multiple
                    hidden
                    @change="handleUploadChange"
                >
            </span>
        </div>

        <!-- 面板 -->
        <div class="ws-detail-panels">
            <section v-show="activeTab === 'overview'" class="ws-detail-panel" data-workspace-detail-panel="overview">
                <div class="ws-detail-panel-list">
                    <WorkspaceOverviewPanel :workspace="workspace" />
                </div>
            </section>

            <section v-show="activeTab === 'chat'" class="ws-detail-panel" data-workspace-detail-panel="chat">
                <div class="ws-detail-panel-list">
                    <WorkspaceConversationsPanel :workspace="workspace" />
                </div>
            </section>

            <section v-show="activeTab === 'knowledge'" class="ws-detail-panel" data-workspace-detail-panel="knowledge">
                <div class="ws-detail-panel-list">
                    <WorkspaceKnowledgePanel :workspace="workspace" />
                </div>
            </section>

            <section v-show="activeTab === 'files'" class="ws-detail-panel" data-workspace-detail-panel="files">
                <div class="ws-detail-panel-list">
                    <WorkspaceFilesPanel :workspace="workspace" />
                </div>
            </section>

            <section v-show="activeTab === 'tasks'" class="ws-detail-panel" data-workspace-detail-panel="tasks">
                <div class="ws-detail-panel-list">
                    <WorkspaceTasksPanel :workspace="workspace" />
                </div>
            </section>

            <section v-show="activeTab === 'memory'" class="ws-detail-panel" data-workspace-detail-panel="memory">
                <div class="ws-detail-panel-list ws-detail-memory">
                    <WorkspaceMemoryPanel :workspace="workspace" />
                </div>
            </section>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, ref } from 'vue'

    import type { WorkspaceDetail } from '@/api/workspaces'

    import { useWorkspaceActions, type WorkspaceDetailTab } from './workspaceContext'

    import WorkspaceOverviewPanel from './panels/WorkspaceOverviewPanel.vue'
    import WorkspaceConversationsPanel from './panels/WorkspaceConversationsPanel.vue'
    import WorkspaceKnowledgePanel from './panels/WorkspaceKnowledgePanel.vue'
    import WorkspaceFilesPanel from './panels/WorkspaceFilesPanel.vue'
    import WorkspaceTasksPanel from './panels/WorkspaceTasksPanel.vue'
    import WorkspaceMemoryPanel from './panels/WorkspaceMemoryPanel.vue'

    const props = defineProps<{
        workspace: WorkspaceDetail
        tab: WorkspaceDetailTab
    }>()

    const emit = defineEmits<{
        'update:tab': [tab: WorkspaceDetailTab]
        /** 返回 Workspace 列表(从详情页回到首页) */
        back: []
    }>()

    const actions = useWorkspaceActions()

    const TABS = [
        { value: 'overview', label: '总览' },
        { value: 'chat', label: '聊天' },
        { value: 'knowledge', label: '知识库' },
        { value: 'files', label: '文件' },
        { value: 'tasks', label: '任务' },
        { value: 'memory', label: '记忆' },
    ] as const

    const activeTab = computed(() => props.tab)

    const title = computed(() => props.workspace.title || 'Untitled Workspace')

    const canShare = computed(() => String(props.workspace.owner_username || '') === actions.currentUserId())

    const sharedCount = computed(() => Array.isArray(props.workspace.shared_users) ? props.workspace.shared_users.length : 0)

    /** ===== 内联改名(对齐原版 bindWorkspaceProjectTitleEditor) ===== */
    const renaming = ref(false)
    const renameSaving = ref(false)
    const renameValue = ref('')
    const renameInputRef = ref<HTMLInputElement | null>(null)

    async function startRename(): Promise<void> {
        if (renameSaving.value) {
            return
        }

        renameValue.value = title.value
        renaming.value = true

        await nextTick(() => {
            const input = renameInputRef.value

            if (input) {
                input.focus()
                input.select()
            }
        })
    }

    function cancelRename(): void {
        if (renameSaving.value) {
            return
        }

        renaming.value = false
        renameValue.value = title.value
    }

    async function commitRename(): Promise<void> {
        if (renameSaving.value || !renaming.value) {
            return
        }

        const nextTitle = renameValue.value.trim()

        if (!nextTitle || nextTitle === title.value) {
            cancelRename()

            return
        }

        renameSaving.value = true

        try {
            const saved = await actions.renameWorkspace(nextTitle)

            // 保存失败时回滚为原标题(由根组件提示错误)
            renaming.value = false

            if (!saved) {
                renameValue.value = title.value
            }
        } finally {
            renameSaving.value = false
        }
    }

    /** ===== 新建空白知识库(请求期间禁用按钮防重复提交,对齐原版 is-loading) ===== */
    const creatingKnowledge = ref(false)

    async function handleCreateKnowledge(): Promise<void> {
        if (creatingKnowledge.value) {
            return
        }

        creatingKnowledge.value = true

        try {
            await actions.createBlankKnowledge('')
        } finally {
            creatingKnowledge.value = false
        }
    }

    /** ===== 上传到 Workspace ===== */
    const uploadInputRef = ref<HTMLInputElement | null>(null)

    async function handleUploadChange(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement
        const files = input.files

        if (files && files.length) {
            await actions.uploadWorkspaceFiles(files)
        }

        input.value = ''
    }
</script>

<style scoped>
    .ws-detail-shell {
        width: 100%;
        min-height: 0;
        margin: 0;
        padding: 42px 40px 56px;
        box-sizing: border-box;
    }

    .ws-detail-header,
    .ws-detail-tabs,
    .ws-detail-panels {
        width: 100%;
        max-width: var(--input-container-max-width, 800px);
        margin-left: auto;
        margin-right: auto;
    }

    .ws-detail-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        margin-bottom: 24px;
    }

    .ws-detail-title-row {
        display: flex;
        align-items: center;
        gap: 14px;
        flex: 1 1 auto;
        min-width: 0;
    }

    .ws-detail-title-icon {
        width: 42px;
        height: 42px;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg-sunken);
        color: var(--color-text-secondary);
        font-size: 20px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
    }

    /* 详情页返回按钮:置于标题行最左,点回 Workspace 列表 */
    .ws-detail-back-btn {
        width: 36px;
        height: 36px;
        border: 1px solid var(--color-border);
        border-radius: 9px;
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        padding: 0;
        font: inherit;
        font-size: 15px;
        cursor: pointer;
        transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
    }

    .ws-detail-back-btn:hover {
        border-color: var(--color-border-strong);
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    .ws-detail-back-btn:focus-visible {
        outline: 2px solid var(--color-text-primary);
        outline-offset: 2px;
    }

    .ws-detail-title-editor {
        min-width: 0;
        max-width: 100%;
        display: inline-flex;
        align-items: center;
        flex: 0 1 auto;
    }

    .ws-detail-title-editor.is-editing {
        flex: 1 1 auto;
        max-width: min(620px, 64vw);
    }

    .ws-detail-title-text {
        margin: 0;
        color: var(--color-text-primary);
        font-size: 30px;
        font-weight: 650;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ws-detail-title-input {
        width: 100%;
        min-width: 260px;
        max-width: 100%;
        height: 42px;
        border: 1px solid var(--color-border-input);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        box-sizing: border-box;
        padding: 0 12px;
        font: inherit;
        font-size: 24px;
        font-weight: 650;
        line-height: 1.2;
        outline: none;
    }

    .ws-detail-title-input:focus {
        border-color: var(--color-accent-text);
        box-shadow: 0 0 0 3px var(--color-accent-surface);
    }

    .ws-detail-title-edit-btn,
    .ws-detail-action-btn {
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 7px;
        background: transparent;
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        padding: 0;
        font: inherit;
        cursor: pointer;
    }

    .ws-detail-title-edit-btn:hover,
    .ws-detail-action-btn:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    .ws-detail-action-btn.is-danger:hover:not(:disabled) {
        background: var(--color-danger-surface);
        color: var(--color-danger-text);
    }

    .ws-detail-title-edit-btn:focus-visible,
    .ws-detail-action-btn:focus-visible {
        outline: 2px solid var(--color-text-primary);
        outline-offset: 2px;
    }

    .ws-detail-action-btn:disabled {
        cursor: default;
        opacity: 0.72;
    }

    .ws-detail-actions {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
    }

    /* ===== tab 栏 ===== */
    .ws-detail-tabs {
        display: flex;
        align-items: center;
        gap: 24px;
        margin-bottom: 28px;
        border-bottom: 1px solid var(--color-border);
    }

    .ws-detail-tab {
        min-width: 0;
        height: 40px;
        border: none;
        border-bottom: 2px solid transparent;
        border-radius: 0;
        background: transparent;
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        padding: 0 2px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
    }

    .ws-detail-tab:hover {
        color: var(--color-text-primary);
    }

    .ws-detail-tab.active {
        color: var(--color-text-primary);
        border-bottom-color: var(--color-accent-text);
    }

    .ws-detail-side-btn {
        margin-left: auto;
        height: 32px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 0 12px;
        font: inherit;
        font-size: 13px;
        font-weight: 650;
        white-space: nowrap;
        cursor: pointer;
        transition: border-color 0.16s ease, background 0.16s ease;
    }

    .ws-detail-file-actions {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 8px;
    }

    .ws-detail-file-actions .ws-detail-side-btn {
        margin-left: 0;
    }

    .ws-detail-side-btn:hover:not(:disabled) {
        border-color: var(--color-border-strong);
        background: var(--color-bg-sunken);
    }

    .ws-detail-side-btn:disabled {
        cursor: default;
        opacity: 0.68;
    }

    /* ===== 面板容器 ===== */
    .ws-detail-panels {
        min-height: 0;
        margin-bottom: 32px;
    }

    .ws-detail-panel {
        min-height: 0;
    }

    .ws-detail-panel-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-height: 0;
        box-sizing: border-box;
    }

    @media (max-width: 1180px) {
        .ws-detail-shell {
            padding-left: 24px;
            padding-right: 24px;
        }
    }

    @media (max-width: 720px) {
        .ws-detail-shell {
            padding: 28px 16px 56px;
        }

        .ws-detail-header {
            margin-bottom: 20px;
        }

        .ws-detail-title-row {
            gap: 10px;
        }

        .ws-detail-title-text {
            font-size: 24px;
        }

        .ws-detail-title-editor.is-editing {
            max-width: calc(100vw - 110px);
        }

        .ws-detail-title-input {
            min-width: 0;
            height: 38px;
            font-size: 20px;
        }

        .ws-detail-title-icon {
            width: 36px;
            height: 36px;
            font-size: 17px;
        }

        .ws-detail-back-btn {
            width: 32px;
            height: 32px;
            font-size: 14px;
        }

        .ws-detail-tabs {
            gap: 18px;
            margin-bottom: 22px;
            overflow-x: auto;
            padding-bottom: 2px;
        }

        .ws-detail-tab {
            height: 34px;
            padding: 0 2px;
            font-size: 14px;
            flex: 0 0 auto;
        }
    }
</style>
