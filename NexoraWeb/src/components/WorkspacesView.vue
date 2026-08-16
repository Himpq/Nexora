<!--
    WorkspacesView.vue — Workspaces 项目视图(对齐原版 openWorkspaceProjectsView)

    设计:
      - 复用原版全局样式类(.workspace-projects-* / .workspace-detail-* ,来自 workspace_projects.css)
      - 列表(筛选 tabs:全部/由你创建/与你共享 + 搜索)+ 新建 + 删除
      - 详情:总览 / 聊天 / 知识库 / 文件 / 任务 / 记忆 六 tab
      - 聊天/知识库/文件行右键 = 置顶/取消置顶(对齐原版 workspaceResourceContextMenu)
      - 重命名 / 分享(共享用户)/ 添加云端文件 / 新建任务 走真实后端
-->

<template>
    <section class="workspace-projects-view" aria-label="Workspaces">
        <div class="workspace-projects-shell">
            <!-- 列表视图 -->
            <template v-if="!detail">
                <div class="workspace-projects-head">
                    <div class="workspace-projects-head-left">
                        <button class="workspace-projects-back" type="button" title="返回" @click="emit('close')">
                            <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                        </button>
                        <h1>Workspaces</h1>
                    </div>
                    <div class="workspace-projects-actions">
                        <label class="workspace-projects-search">
                            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                            <input
                                v-model="query"
                                type="search"
                                placeholder="搜索 Workspaces"
                                aria-label="搜索 Workspaces"
                            >
                        </label>
                        <button class="workspace-projects-create" type="button" @click="handleCreate">新建</button>
                    </div>
                </div>

                <div class="workspace-projects-tabs" role="tablist" aria-label="Workspaces 筛选">
                    <button
                        v-for="tab in tabs"
                        :key="tab.value"
                        class="workspace-projects-tab"
                        :class="{ active: filter === tab.value }"
                        type="button"
                        role="tab"
                        :aria-selected="filter === tab.value"
                        @click="filter = tab.value"
                    >{{ tab.label }}</button>
                </div>

                <div class="workspace-projects-table" role="table" aria-label="Workspaces 列表">
                    <div class="workspace-projects-row workspace-projects-row-head" role="row">
                        <div role="columnheader">名称</div>
                        <div role="columnheader">修改时间</div>
                    </div>

                    <div class="workspace-projects-list">
                        <div v-if="loading" class="workspace-projects-empty">加载中...</div>
                        <div v-else-if="!filteredWorkspaces.length" class="workspace-projects-empty">暂无 Workspaces</div>

                        <button
                            v-for="workspace in filteredWorkspaces"
                            :key="workspace.workspace_id"
                            class="workspace-projects-row workspace-projects-item"
                            type="button"
                            role="row"
                            @click="openDetail(workspace.workspace_id)"
                        >
                            <span class="workspace-projects-name" role="cell">
                                <span class="workspace-projects-folder">
                                    <i class="fa-regular fa-folder" aria-hidden="true"></i>
                                </span>
                                <span>{{ workspace.title || 'Untitled Workspace' }}</span>
                            </span>
                            <span class="workspace-projects-date" role="cell">{{ formatWorkspaceDate(workspace.updated_at || workspace.created_at) }}</span>
                        </button>
                    </div>
                </div>
            </template>

            <!-- 详情视图 -->
            <template v-else>
                <div class="workspace-projects-head">
                    <div class="workspace-projects-detail-head">
                        <button class="workspace-projects-back" type="button" title="返回列表" @click="detail = null; void load()">
                            <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                        </button>
                        <div class="workspace-detail-title-editor">
                            <h1 class="workspace-detail-title-text">{{ detail.title || 'Untitled Workspace' }}</h1>
                            <button
                                class="workspace-detail-title-edit-btn"
                                type="button"
                                title="修改名称"
                                aria-label="修改名称"
                                @click="handleRename"
                            >
                                <i class="fa-solid fa-pen" aria-hidden="true"></i>
                            </button>
                        </div>
                        <div class="workspace-projects-meta">
                            创建者:{{ detail.owner_username || '-' }} · 更新:{{ formatWorkspaceDate(detail.updated_at) }}
                        </div>
                    </div>
                    <div class="workspace-projects-actions">
                        <button
                            class="workspace-detail-share-btn"
                            type="button"
                            title="分享 Workspace"
                            :disabled="!isOwner"
                            @click="openShare"
                        >
                            <i class="fa-solid fa-share-nodes" aria-hidden="true"></i>
                        </button>
                        <button
                            class="workspace-projects-create workspace-detail-delete-btn"
                            type="button"
                            :disabled="!isOwner"
                            @click="handleDelete(detail)"
                        >删除</button>
                    </div>
                </div>

                <!-- 详情 tab 栏(对齐原版 workspace-detail-tabs) -->
                <div class="workspace-detail-tabs" role="tablist" aria-label="Workspace 内容">
                    <button
                        v-for="tab in detailTabs"
                        :key="tab"
                        class="workspace-detail-tab"
                        :class="{ active: detailTab === tab }"
                        type="button"
                        role="tab"
                        :aria-selected="detailTab === tab"
                        @click="detailTab = tab"
                    >{{ detailTabLabel(tab) }}</button>
                </div>

                <div class="workspace-detail-panels">
                    <!-- 总览 -->
                    <section v-show="detailTab === 'overview'" class="workspace-detail-panel">
                        <div class="workspace-projects-stats">
                            <div class="workspace-projects-stat">
                                <span class="workspace-projects-stat-num">{{ detail.conversation_count ?? 0 }}</span>
                                <span class="workspace-projects-stat-label">对话</span>
                            </div>
                            <div class="workspace-projects-stat">
                                <span class="workspace-projects-stat-num">{{ detail.knowledge_document_count ?? 0 }}</span>
                                <span class="workspace-projects-stat-label">知识库</span>
                            </div>
                            <div class="workspace-projects-stat">
                                <span class="workspace-projects-stat-num">{{ detail.file_count ?? 0 }}</span>
                                <span class="workspace-projects-stat-label">文件</span>
                            </div>
                            <div class="workspace-projects-stat">
                                <span class="workspace-projects-stat-num">{{ detail.open_task_count ?? 0 }}</span>
                                <span class="workspace-projects-stat-label">进行中任务</span>
                            </div>
                        </div>

                        <div class="workspace-projects-activity">
                            <h3>最近活动</h3>
                            <div v-if="!activityItems.length" class="workspace-projects-empty">暂无活动记录</div>
                            <div v-for="(item, index) in activityItems" :key="index" class="workspace-projects-activity-item">
                                <i class="fa-solid fa-circle" aria-hidden="true"></i>
                                <span class="workspace-projects-activity-title">{{ item.title }}</span>
                                <span class="workspace-projects-activity-time">{{ formatWorkspaceDate(item.time) }}</span>
                            </div>
                        </div>
                    </section>

                    <!-- 聊天 -->
                    <section v-show="detailTab === 'chat'" class="workspace-detail-panel">
                        <div class="workspace-detail-panel-list workspace-detail-conversations">
                            <div v-if="!detailConversations.length" class="workspace-projects-empty">暂无对话</div>
                            <button
                                v-for="conv in detailConversations"
                                :key="conv.conversation_id"
                                class="workspace-resource-row"
                                :class="{ pinned: conv.pin }"
                                type="button"
                                @click="openConversation(conv.conversation_id)"
                                @contextmenu.prevent="openResourceMenu($event, 'conversation', conv.conversation_id, String(conv.title || ''), Boolean(conv.pin), String(conv.added_by || ''))"
                            >
                                <i :class="conv.pin ? 'fa-solid fa-thumbtack' : 'fa-regular fa-comment'" aria-hidden="true"></i>
                                <span class="workspace-resource-title">{{ conv.title || conv.conversation_id }}</span>
                                <span class="workspace-resource-meta">
                                    {{ conv.pin ? '已置顶 · ' : '' }}{{ formatWorkspaceDate(conv.added_at) }}
                                </span>
                            </button>
                        </div>
                    </section>

                    <!-- 知识库 -->
                    <section v-show="detailTab === 'knowledge'" class="workspace-detail-panel">
                        <div class="workspace-detail-panel-list">
                            <div v-if="!detailKnowledge.length" class="workspace-projects-empty">暂无知识库</div>
                            <button
                                v-for="doc in detailKnowledge"
                                :key="doc.title"
                                class="workspace-resource-row"
                                :class="{ pinned: doc.pin }"
                                type="button"
                                @contextmenu.prevent="openResourceMenu($event, 'knowledge', doc.title, doc.title, Boolean(doc.pin), String(doc.added_by || ''))"
                            >
                                <i :class="doc.pin ? 'fa-solid fa-thumbtack' : 'fa-regular fa-book'" aria-hidden="true"></i>
                                <span class="workspace-resource-title">{{ doc.title }}</span>
                                <span class="workspace-resource-meta">
                                    {{ visibilityLabel(doc.visibility) }} · {{ doc.pin ? '已置顶' : '未置顶' }}
                                </span>
                            </button>
                        </div>
                    </section>

                    <!-- 文件 -->
                    <section v-show="detailTab === 'files'" class="workspace-detail-panel">
                        <div class="workspace-detail-panel-list">
                            <div v-if="!detailFiles.length" class="workspace-projects-empty">暂无文件</div>
                            <button
                                v-for="file in detailFiles"
                                :key="file.file_ref"
                                class="workspace-resource-row"
                                :class="{ pinned: file.pin }"
                                type="button"
                                @contextmenu.prevent="openResourceMenu($event, 'file', file.file_ref, String(file.alias || file.file_ref), Boolean(file.pin), String(file.added_by || ''))"
                            >
                                <i :class="file.pin ? 'fa-solid fa-thumbtack' : 'fa-regular fa-file'" aria-hidden="true"></i>
                                <span class="workspace-resource-title">{{ file.alias || file.file_ref }}</span>
                                <span class="workspace-resource-meta">
                                    {{ visibilityLabel(file.visibility) }} · {{ file.pin ? '已置顶' : '未置顶' }}
                                </span>
                            </button>
                            <button class="workspace-resource-add" type="button" @click="openAddFile">
                                <i class="fa-solid fa-link" aria-hidden="true"></i>
                                <span>添加云端文件</span>
                            </button>
                        </div>
                    </section>

                    <!-- 任务 -->
                    <section v-show="detailTab === 'tasks'" class="workspace-detail-panel">
                        <div class="workspace-detail-panel-list">
                            <div v-if="!detailTasks.length" class="workspace-projects-empty">暂无任务</div>
                            <div v-for="task in detailTasks" :key="String(task.task_id || task.title || '')" class="workspace-task-row">
                                <i class="fa-regular fa-square-check" aria-hidden="true"></i>
                                <span class="workspace-resource-title">{{ task.title || '未命名任务' }}</span>
                                <span class="workspace-resource-meta">{{ taskStatusLabel(task.status) }} · {{ task.priority || '中' }}</span>
                            </div>
                            <button class="workspace-resource-add" type="button" @click="handleAddTask">
                                <i class="fa-solid fa-plus" aria-hidden="true"></i>
                                <span>新建任务</span>
                            </button>
                        </div>
                    </section>

                    <!-- 记忆 -->
                    <section v-show="detailTab === 'memory'" class="workspace-detail-panel">
                        <div class="workspace-detail-panel-list workspace-detail-memory">
                            <div v-if="!memoryContent" class="workspace-projects-empty">暂无记忆沉淀</div>
                            <div v-else class="workspace-detail-memory-markdown">
                                <MarkdownView :content="memoryContent" />
                            </div>
                        </div>
                    </section>
                </div>
            </template>
        </div>

        <!-- 资源右键菜单(对齐原版 workspaceResourceContextMenu) -->
        <div
            v-if="resourceMenu.visible"
            class="workspace-resource-context-menu active"
            :style="{ left: `${resourceMenu.x}px`, top: `${resourceMenu.y}px` }"
            @click.stop
        >
            <button type="button" @click="submitResourcePin">
                <i class="fa-solid fa-thumbtack" aria-hidden="true"></i>
                <span>{{ resourceMenu.pinned ? '取消置顶' : '置顶' }}</span>
            </button>
        </div>

        <!-- 分享弹窗 -->
        <Modal :open="shareOpen" title="分享 Workspace" size="sm" @close="shareOpen = false">
            <div class="form-group">
                <label>已共享用户</label>
                <div v-if="!shareUsers.length" class="workspace-share-empty">暂未共享给任何用户</div>
                <div v-for="username in shareUsers" :key="username" class="workspace-share-user">
                    <span>{{ username }}</span>
                    <button type="button" title="移除" @click="shareUsers = shareUsers.filter((u) => u !== username)">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
            <div class="form-group">
                <label for="workspaceShareInput">添加共享用户</label>
                <input id="workspaceShareInput" v-model="shareInput" class="input-modern" type="text" placeholder="输入用户名" @keydown.enter="addShareUser">
            </div>
            <template #footer>
                <button class="btn-cancel" type="button" @click="shareOpen = false">取消</button>
                <button class="btn-confirm" type="button" :disabled="shareSaving" @click="saveShare">保存</button>
            </template>
        </Modal>

        <!-- 添加云端文件弹窗 -->
        <Modal :open="addFileOpen" title="添加云端文件" size="sm" @close="addFileOpen = false">
            <div class="workspace-file-picker">
                <div v-if="cloudFilesLoading" class="workspace-projects-empty">加载中...</div>
                <div v-else-if="!cloudFiles.length" class="workspace-projects-empty">暂无云端文件,请先在文件中心上传</div>
                <button
                    v-for="file in cloudFiles"
                    :key="String(file.name)"
                    class="workspace-resource-row"
                    type="button"
                    @click="handleAddFile(file)"
                >
                    <i class="fa-regular fa-file" aria-hidden="true"></i>
                    <span class="workspace-resource-title">{{ String(file.alias || file.name) }}</span>
                </button>
            </div>
        </Modal>
    </section>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

    import type { CloudFileItem } from '@/api/files'
    import { listCloudFiles } from '@/api/files'
    import type { WorkspaceConversation, WorkspaceDetail, WorkspaceFileEntry, WorkspaceKnowledgeDocument, WorkspaceSummary, WorkspaceTaskEntry } from '@/api/workspaces'
    import {
        addWorkspaceFile,
        createWorkspace,
        createWorkspaceTask,
        deleteWorkspace,
        fetchWorkspace,
        formatWorkspaceDate,
        listWorkspaces,
        pinWorkspaceConversation,
        pinWorkspaceFile,
        pinWorkspaceKnowledge,
        updateWorkspaceSettings,
    } from '@/api/workspaces'
    import { showConfirm, showPrompt } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'

    import MarkdownView from './MarkdownView.vue'
    import Modal from '@/ui/Modal.vue'

    const emit = defineEmits<{
        close: []
        /** 点击项目内对话:回到聊天并打开该会话 */
        'open-conversation': [conversationId: string]
    }>()

    const userStore = useUserStore()

    const loading = ref(false)
    const workspaces = ref<WorkspaceSummary[]>([])
    const query = ref('')
    const filter = ref<'all' | 'owned' | 'shared'>('all')
    const detail = ref<WorkspaceDetail | null>(null)

    const tabs = [
        { value: 'all', label: '全部' },
        { value: 'owned', label: '由你创建' },
        { value: 'shared', label: '与你共享' },
    ] as const

    const detailTabs = ['overview', 'chat', 'knowledge', 'files', 'tasks', 'memory'] as const
    const detailTab = ref<(typeof detailTabs)[number]>('overview')

    /** 筛选 + 搜索后的列表(对齐原版 getFilteredWorkspaceProjects) */
    const filteredWorkspaces = computed(() => {
        const keyword = query.value.trim().toLowerCase()

        return workspaces.value.filter((workspace) => {
            if (filter.value === 'owned' && workspace.owner_username !== undefined && !isOwned(workspace)) {
                return false
            }

            if (filter.value === 'shared' && !isShared(workspace)) {
                return false
            }

            if (keyword && !String(workspace.title || '').toLowerCase().includes(keyword)) {
                return false
            }

            return true
        })
    })

    /** 详情资源列表 */
    const detailConversations = computed<WorkspaceConversation[]>(() => {
        return Array.isArray(detail.value?.conversations) ? detail.value.conversations : []
    })

    const detailKnowledge = computed<WorkspaceKnowledgeDocument[]>(() => {
        return Array.isArray(detail.value?.knowledge_documents) ? detail.value.knowledge_documents : []
    })

    const detailFiles = computed<WorkspaceFileEntry[]>(() => {
        return Array.isArray(detail.value?.workspace_files) ? detail.value.workspace_files : []
    })

    const detailTasks = computed<WorkspaceTaskEntry[]>(() => {
        return Array.isArray(detail.value?.workspace_tasks) ? detail.value.workspace_tasks : []
    })

    /** 记忆正文 */
    const memoryContent = computed(() => {
        const memory = detail.value?.workspace_memory

        if (memory && typeof memory === 'object' && String(memory.content || '').trim()) {
            return String(memory.content)
        }

        return ''
    })

    /** 详情活动列表(对齐原版 renderWorkspaceOverviewActivityRows) */
    const activityItems = computed(() => {
        const items = detail.value?.overview?.activity_items

        return Array.isArray(items) ? items : []
    })

    /** 是否为当前用户创建的 Workspace(控制分享/删除可用性) */
    const isOwner = computed(() => {
        return String(detail.value?.owner_username || '') === String(userStore.username || '')
    })

    onMounted(() => {
        void load()
        document.addEventListener('click', hideResourceMenu)
        document.addEventListener('scroll', hideResourceMenu, true)
    })

    onBeforeUnmount(() => {
        document.removeEventListener('click', hideResourceMenu)
        document.removeEventListener('scroll', hideResourceMenu, true)
    })

    /** 是否当前用户创建(对齐原版 owner_username 与当前用户比对) */
    function isOwned(workspace: WorkspaceSummary): boolean {
        return String(workspace.owner_username || '') === String(userStore.username || '')
    }

    /** 是否共享:非本人创建的即视为共享 */
    function isShared(workspace: WorkspaceSummary): boolean {
        return !isOwned(workspace)
    }

    function detailTabLabel(tab: string): string {
        const labels: Record<string, string> = {
            overview: '总览',
            chat: '聊天',
            knowledge: '知识库',
            files: '文件',
            tasks: '任务',
            memory: '记忆',
        }

        return labels[tab] || tab
    }

    function visibilityLabel(visibility?: string): string {
        const value = String(visibility || '').toLowerCase()

        if (value === 'shared') {
            return '共享'
        }

        return '私有'
    }

    function taskStatusLabel(status?: string): string {
        const value = String(status || '').toLowerCase()

        if (value === 'done') {
            return '已完成'
        }

        if (value === 'cancelled') {
            return '已取消'
        }

        if (value === 'in_progress') {
            return '进行中'
        }

        return '待办'
    }

    /** 加载项目列表(对齐原版 loadWorkspaceProjects) */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            workspaces.value = await listWorkspaces()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载 Workspaces 失败')
        } finally {
            loading.value = false
        }
    }

    /** 打开详情(对齐原版 openWorkspaceProjectDetailView) */
    async function openDetail(workspaceId: string): Promise<void> {
        try {
            detail.value = await fetchWorkspace(workspaceId)
            detailTab.value = 'overview'
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载项目失败')
        }
    }

    /** 新建项目(对齐原版 ensureWorkspaceCreateModal) */
    async function handleCreate(): Promise<void> {
        const title = await showPrompt({
            title: '新建 Workspace',
            label: '名称',
            placeholder: '例如:日本之旅',
            confirmText: '创建',
            cancelText: '取消',
        })

        const trimmed = String(title || '').trim()

        if (!trimmed) {
            return
        }

        try {
            await createWorkspace(trimmed)

            showToast('已创建 Workspace', 'success')
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '创建失败')
        }
    }

    /** 重命名(对齐原版 workspace-detail-title-editor) */
    async function handleRename(): Promise<void> {
        const next = await showPrompt({
            title: '修改 Workspace 名称',
            label: '名称',
            defaultValue: String(detail.value?.title || ''),
            confirmText: '保存',
            cancelText: '取消',
        })

        const trimmed = String(next || '').trim()

        if (!trimmed || !detail.value) {
            return
        }

        try {
            detail.value = await updateWorkspaceSettings(detail.value.workspace_id, { title: trimmed })

            showToast('名称已更新', 'success')
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '重命名失败')
        }
    }

    /** 删除项目(仅创建者,对齐原版删除确认) */
    async function handleDelete(workspace: WorkspaceDetail): Promise<void> {
        const confirmed = await showConfirm({
            title: '删除 Workspace',
            content: `确定删除「${workspace.title}」吗?此操作不可恢复。`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            await deleteWorkspace(workspace.workspace_id)

            showToast('已删除', 'success')
            detail.value = null
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }

    /** 点击项目内对话:回到聊天并打开该会话 */
    async function openConversation(conversationId: string): Promise<void> {
        emit('open-conversation', conversationId)
    }

    /** ===== 资源右键菜单(置顶) ===== */
    interface ResourceMenuState {
        visible: boolean
        x: number
        y: number
        type: 'conversation' | 'knowledge' | 'file'
        ref: string
        title: string
        pinned: boolean
        addedBy: string
    }

    const resourceMenu = ref<ResourceMenuState>({
        visible: false,
        x: 0,
        y: 0,
        type: 'conversation',
        ref: '',
        title: '',
        pinned: false,
        addedBy: '',
    })

    /** 打开资源右键菜单(对齐原版 showWorkspaceResourceContextMenu) */
    function openResourceMenu(
        event: MouseEvent,
        type: ResourceMenuState['type'],
        ref: string,
        title: string,
        pinned: boolean,
        addedBy: string
    ): void {
        resourceMenu.value = {
            visible: true,
            x: Math.min(Math.max(8, event.clientX), Math.max(8, window.innerWidth - 160)),
            y: Math.min(Math.max(8, event.clientY), Math.max(8, window.innerHeight - 60)),
            type,
            ref,
            title,
            pinned: Boolean(pinned),
            addedBy,
        }
    }

    function hideResourceMenu(): void {
        if (resourceMenu.value.visible) {
            resourceMenu.value.visible = false
        }
    }

    /** 提交置顶/取消置顶(对齐原版 submitWorkspaceResourcePin) */
    async function submitResourcePin(): Promise<void> {
        const state = { ...resourceMenu.value }
        const workspace = detail.value

        hideResourceMenu()

        if (!workspace) {
            return
        }

        const nextPin = !state.pinned

        try {
            if (state.type === 'conversation') {
                detail.value = await pinWorkspaceConversation(workspace.workspace_id, state.ref, nextPin)
            } else if (state.type === 'knowledge') {
                detail.value = await pinWorkspaceKnowledge(workspace.workspace_id, state.ref, state.addedBy, nextPin)
            } else {
                detail.value = await pinWorkspaceFile(workspace.workspace_id, state.ref, state.addedBy, nextPin)
            }

            showToast(nextPin ? '已置顶' : '已取消置顶', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '置顶失败')
        }
    }

    /** ===== 分享 ===== */
    const shareOpen = ref(false)
    const shareSaving = ref(false)
    const shareInput = ref('')
    const shareUsers = ref<string[]>([])

    function openShare(): void {
        shareUsers.value = Array.isArray(detail.value?.shared_users) ? [...detail.value.shared_users] : []
        shareInput.value = ''
        shareOpen.value = true
    }

    function addShareUser(): void {
        const username = shareInput.value.trim()

        if (!username) {
            return
        }

        if (!shareUsers.value.includes(username)) {
            shareUsers.value.push(username)
        }

        shareInput.value = ''
    }

    async function saveShare(): Promise<void> {
        if (!detail.value) {
            return
        }

        shareSaving.value = true

        try {
            detail.value = await updateWorkspaceSettings(detail.value.workspace_id, { shared_users: shareUsers.value })

            showToast('分享设置已保存', 'success')
            shareOpen.value = false
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        } finally {
            shareSaving.value = false
        }
    }

    /** ===== 添加云端文件 ===== */
    const addFileOpen = ref(false)
    const cloudFilesLoading = ref(false)
    const cloudFiles = ref<CloudFileItem[]>([])

    async function openAddFile(): Promise<void> {
        addFileOpen.value = true
        cloudFilesLoading.value = true

        try {
            cloudFiles.value = await listCloudFiles({})
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载云端文件失败')
        } finally {
            cloudFilesLoading.value = false
        }
    }

    async function handleAddFile(file: CloudFileItem): Promise<void> {
        if (!detail.value) {
            return
        }

        const fileRef = String(file.sandbox_path || file.alias || file.name || '').trim()

        if (!fileRef) {
            showToast('文件路径无效', 'warning')

            return
        }

        try {
            detail.value = await addWorkspaceFile(detail.value.workspace_id, fileRef)

            showToast('文件已添加到 Workspace', 'success')
            addFileOpen.value = false
        } catch (error) {
            showError(error instanceof Error ? error.message : '添加文件失败')
        }
    }

    /** ===== 新建任务 ===== */
    async function handleAddTask(): Promise<void> {
        const title = await showPrompt({
            title: '新建任务',
            label: '任务名称',
            placeholder: '例如:调研竞品',
            confirmText: '创建',
            cancelText: '取消',
        })

        const trimmed = String(title || '').trim()

        if (!trimmed || !detail.value) {
            return
        }

        try {
            detail.value = await createWorkspaceTask(detail.value.workspace_id, { title: trimmed })

            showToast('任务已创建', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '创建任务失败')
        }
    }
</script>

<style scoped>
    /* 详情页可编辑标题 */
    .workspace-detail-title-editor {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .workspace-detail-title-text {
        margin: 0;
        font-size: 20px;
        color: #0f172a;
    }

    .workspace-detail-title-edit-btn {
        width: 26px;
        height: 26px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        background: #fff;
        color: #64748b;
        font-size: 12px;
        cursor: pointer;
        transition: border-color 0.15s ease, color 0.15s ease;
    }

    .workspace-detail-title-edit-btn:hover {
        border-color: #4f46e5;
        color: #4f46e5;
    }

    .workspace-detail-tabs {
        display: flex;
        align-items: center;
        gap: 4px;
        border-bottom: 1px solid #e2e8f0;
        margin-bottom: 14px;
    }

    .workspace-detail-tab {
        padding: 9px 14px;
        border: none;
        background: transparent;
        font-size: 13px;
        color: #64748b;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: color 0.15s ease, border-color 0.15s ease;
    }

    .workspace-detail-tab:hover {
        color: #0f172a;
    }

    .workspace-detail-tab.active {
        color: #4f46e5;
        font-weight: 600;
        border-bottom-color: #4f46e5;
    }

    /* 资源行(对话/知识库/文件) */
    .workspace-resource-row {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 10px 12px;
        border: none;
        border-bottom: 1px solid #f1f5f9;
        background: #fff;
        text-align: left;
        cursor: pointer;
        transition: background 0.15s ease;
    }

    .workspace-resource-row:hover {
        background: #f8fafc;
    }

    .workspace-resource-row.pinned {
        background: #f5f3ff;
    }

    .workspace-resource-row i {
        flex: none;
        width: 18px;
        color: #94a3b8;
        font-size: 13px;
        text-align: center;
    }

    .workspace-resource-row.pinned i {
        color: #4f46e5;
    }

    .workspace-resource-title {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 500;
        color: #0f172a;
    }

    .workspace-resource-meta {
        flex: none;
        font-size: 11px;
        color: #94a3b8;
    }

    .workspace-resource-add {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin: 10px 0 0;
        padding: 8px 14px;
        border: 1px dashed #c7d2fe;
        border-radius: 8px;
        background: #f8faff;
        color: #4f46e5;
        font-size: 12.5px;
        cursor: pointer;
        transition: background 0.15s ease;
    }

    .workspace-resource-add:hover {
        background: #eef2ff;
    }

    /* 任务行(非按钮) */
    .workspace-task-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid #f1f5f9;
    }

    .workspace-task-row i {
        flex: none;
        color: #94a3b8;
        font-size: 13px;
    }

    /* 右键菜单(对齐原版 workspace-resource-context-menu) */
    .workspace-resource-context-menu {
        position: fixed;
        z-index: 30000;
        min-width: 136px;
        padding: 5px;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        background: #fff;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.14);
        display: flex;
        flex-direction: column;
    }

    .workspace-resource-context-menu button {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border: none;
        border-radius: 6px;
        background: transparent;
        font-size: 13px;
        color: #334155;
        cursor: pointer;
    }

    .workspace-resource-context-menu button:hover {
        background: #eef2ff;
        color: #4f46e5;
    }

    /* 分享 */
    .workspace-share-empty {
        padding: 8px 0;
        font-size: 12.5px;
        color: #94a3b8;
    }

    .workspace-share-user {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        border-radius: 6px;
        background: #f8fafc;
        font-size: 13px;
        color: #0f172a;
    }

    .workspace-share-user button {
        border: none;
        background: transparent;
        color: #94a3b8;
        cursor: pointer;
        font-size: 12px;
    }

    .workspace-share-user button:hover {
        color: #dc2626;
    }

    /* 文件选择器 */
    .workspace-file-picker {
        max-height: 340px;
        overflow-y: auto;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
    }

    .workspace-detail-panels {
        min-height: 300px;
    }

    .workspace-detail-panel-list {
        display: flex;
        flex-direction: column;
    }

    .workspace-detail-memory-markdown {
        padding: 14px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        background: #f8fafc;
    }
</style>