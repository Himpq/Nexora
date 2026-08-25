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
    <section v-if="!detail" class="workspace-projects-view" aria-label="Workspaces">
        <div class="workspace-projects-shell">
            <!-- 列表视图 -->
                <div class="workspace-projects-head">
                    <h1>Workspaces</h1>
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

                    <div id="workspaceProjectsList">
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
        </div>
    </section>

            <!-- 详情视图 -->
    <section v-else class="workspace-detail-view" aria-label="Workspace Detail">
        <div class="workspace-detail-shell">
            <div class="workspace-detail-header">
                <div class="workspace-detail-title-row">
                    <span class="workspace-detail-title-icon">
                        <i class="fa-regular fa-folder" aria-hidden="true"></i>
                    </span>
                    <span class="workspace-detail-title-editor">
                        <h1 class="workspace-detail-title-text">{{ detail.title || 'Untitled Workspace' }}</h1>
                        <input class="workspace-detail-title-input" type="text" :value="detail.title || 'Untitled Workspace'" aria-label="Workspace 名称" hidden>
                    </span>
                    <button class="workspace-detail-title-edit-btn" type="button" title="修改 Workspace 名称" aria-label="修改 Workspace 名称" @click="handleRename">
                        <i class="fa-solid fa-pen" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="workspace-detail-actions" aria-label="Workspace 操作">
                    <button class="workspace-detail-share-btn" type="button" title="分享 Workspace" aria-label="分享 Workspace" :disabled="!isOwner" @click="openShare">
                        <i class="fa-solid fa-share-nodes" aria-hidden="true"></i>
                    </button>
                    <button class="workspace-detail-delete-btn" type="button" title="删除 Workspace" aria-label="删除 Workspace" :disabled="!isOwner" @click="handleDelete(detail)">
                        <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                    </button>
                </div>
            </div>

            <div class="workspace-detail-input-slot" id="workspaceDetailInputSlot"></div>

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
                        :data-workspace-detail-tab="tab"
                        @click="detailTab = tab"
                    ><span>{{ detailTabLabel(tab) }}</span></button>
                    <button v-if="detailTab === 'knowledge'" class="workspace-detail-create-knowledge" type="button" title="新建空白知识库" aria-label="新建空白知识库">
                        <i class="fa-solid fa-plus" aria-hidden="true"></i>
                        <span>新建</span>
                    </button>
                    <span v-if="detailTab === 'files'" class="workspace-detail-file-actions">
                        <button class="workspace-detail-file-action" type="button" title="添加已有云端文件" aria-label="添加已有云端文件" @click="openAddFile">
                            <i class="fa-solid fa-link" aria-hidden="true"></i>
                            <span>添加</span>
                        </button>
                    </span>
                </div>

                <div class="workspace-detail-panels">
                    <!-- 总览 -->
                    <section v-show="detailTab === 'overview'" class="workspace-detail-panel" :class="{ active: detailTab === 'overview' }" data-workspace-detail-panel="overview">
                        <div class="workspace-detail-panel-list">
                            <div class="workspace-overview">
                                <div class="workspace-overview-stats">
                                    <div class="workspace-overview-stat">
                                        <span class="workspace-overview-stat-icon"><i class="fa-regular fa-comments" aria-hidden="true"></i></span>
                                        <span class="workspace-overview-stat-main"><span class="workspace-overview-stat-value">{{ detail.conversation_count ?? 0 }}</span><span class="workspace-overview-stat-label">聊天</span></span>
                                    </div>
                                    <div class="workspace-overview-stat">
                                        <span class="workspace-overview-stat-icon"><i class="fa-solid fa-database" aria-hidden="true"></i></span>
                                        <span class="workspace-overview-stat-main"><span class="workspace-overview-stat-value">{{ detail.knowledge_document_count ?? 0 }}</span><span class="workspace-overview-stat-label">知识库</span></span>
                                    </div>
                                    <div class="workspace-overview-stat">
                                        <span class="workspace-overview-stat-icon"><i class="fa-regular fa-file-lines" aria-hidden="true"></i></span>
                                        <span class="workspace-overview-stat-main"><span class="workspace-overview-stat-value">{{ detail.workspace_file_count ?? detail.file_count ?? 0 }}</span><span class="workspace-overview-stat-label">文件</span></span>
                                    </div>
                                    <div class="workspace-overview-stat">
                                        <span class="workspace-overview-stat-icon"><i class="fa-regular fa-circle-check" aria-hidden="true"></i></span>
                                        <span class="workspace-overview-stat-main"><span class="workspace-overview-stat-value">{{ detail.open_task_count ?? 0 }}</span><span class="workspace-overview-stat-label">未完成任务</span></span>
                                    </div>
                                </div>
                                <div class="workspace-overview-grid">
                                    <section class="workspace-overview-section">
                                        <div class="workspace-overview-section-head"><h2>待办</h2><span>{{ detailTasks.length }} 个任务</span></div>
                                        <div v-if="!detailTasks.length" class="workspace-detail-empty">暂无任务</div>
                                        <div v-for="task in detailTasks.slice(0, 8)" :key="String(task.task_id || task.title || '')" class="workspace-overview-task">
                                            <span class="workspace-overview-task-main"><span class="workspace-overview-task-title">{{ task.title || '未命名任务' }}</span><span class="workspace-overview-task-meta">{{ taskStatusLabel(task.status) }}</span></span>
                                        </div>
                                    </section>
                                    <section class="workspace-overview-section">
                                        <div class="workspace-overview-section-head"><h2>活动流</h2></div>
                                        <div v-if="!activityItems.length" class="workspace-detail-empty">暂无活动记录</div>
                                        <div v-for="(item, index) in activityItems" :key="index" class="workspace-overview-activity">
                                            <span class="workspace-overview-activity-main"><span class="workspace-overview-activity-title">{{ item.title }}</span><span class="workspace-overview-activity-meta">{{ formatWorkspaceDate(item.time) }}</span></span>
                                        </div>
                                    </section>
                                </div>
                            </div>
                        </div>
                    </section>

                    <!-- 聊天 -->
                    <section v-show="detailTab === 'chat'" class="workspace-detail-panel" :class="{ active: detailTab === 'chat' }" data-workspace-detail-panel="chat">
                        <div class="workspace-detail-panel-list workspace-detail-conversations" id="workspaceProjectConversations">
                            <div v-if="!detailConversations.length" class="workspace-detail-empty">暂无已加入的对话</div>
                            <div
                                v-for="conv in detailConversations"
                                :key="conv.conversation_id"
                                class="workspace-detail-conversation is-clickable"
                                :class="{ 'is-pinned': conv.pin }"
                                role="button"
                                tabindex="0"
                                @click="openConversation(conv.conversation_id)"
                                @contextmenu.prevent="openResourceMenu($event, 'conversation', conv.conversation_id, String(conv.title || ''), Boolean(conv.pin), String(conv.added_by || ''))"
                            >
                                <span class="workspace-detail-conversation-main">
                                    <strong><i v-if="conv.pin" class="fa-solid fa-thumbtack workspace-detail-pin-icon" aria-hidden="true"></i>{{ conv.title || conv.conversation_id }}</strong>
                                    <small>{{ conv.added_by ? `@${conv.added_by}` : '未知用户' }}</small>
                                </span>
                                <span class="workspace-detail-row-side"><span class="workspace-detail-row-date">{{ formatWorkspaceDate(conv.added_at) }}</span></span>
                            </div>
                        </div>
                    </section>

                    <!-- 知识库 -->
                    <section v-show="detailTab === 'knowledge'" class="workspace-detail-panel" :class="{ active: detailTab === 'knowledge' }" data-workspace-detail-panel="knowledge">
                        <div class="workspace-detail-panel-list" id="workspaceProjectKnowledgeDocuments">
                            <div v-if="!detailKnowledge.length" class="workspace-detail-empty">暂无知识库内容</div>
                            <div
                                v-for="doc in detailKnowledge"
                                :key="doc.title"
                                class="workspace-detail-resource workspace-detail-knowledge is-clickable"
                                :class="{ 'is-pinned': doc.pin }"
                                role="button"
                                tabindex="0"
                                @contextmenu.prevent="openResourceMenu($event, 'knowledge', doc.title, doc.title, Boolean(doc.pin), String(doc.added_by || ''))"
                            >
                                <span class="workspace-detail-resource-icon"><i class="fa-solid fa-database" aria-hidden="true"></i></span>
                                <span class="workspace-detail-resource-main"><span class="workspace-detail-resource-title"><i v-if="doc.pin" class="fa-solid fa-thumbtack workspace-detail-pin-icon" aria-hidden="true"></i>{{ doc.title }}</span><span class="workspace-detail-resource-meta">{{ doc.added_by ? `@${doc.added_by}` : '未知用户' }}</span></span>
                                <span class="workspace-detail-row-side"><span class="workspace-detail-row-date">{{ formatWorkspaceDate(String(doc.added_at || '')) }}</span></span>
                            </div>
                        </div>
                    </section>

                    <!-- 文件 -->
                    <section v-show="detailTab === 'files'" class="workspace-detail-panel" :class="{ active: detailTab === 'files' }" data-workspace-detail-panel="files">
                        <div class="workspace-detail-panel-list" id="workspaceProjectFiles">
                            <div v-if="!detailFiles.length" class="workspace-detail-empty">暂无文件</div>
                            <div
                                v-for="file in detailFiles"
                                :key="file.file_ref"
                                class="file-center-card workspace-detail-file is-clickable"
                                :class="{ 'is-pinned': file.pin }"
                                role="button"
                                tabindex="0"
                                @click="openWorkspaceFile(file)"
                                @contextmenu.prevent="openResourceMenu($event, 'file', file.file_ref, String(file.alias || file.file_ref), Boolean(file.pin), String(file.added_by || ''))"
                            >
                                <div class="file-center-card-icon-wrap"><span class="file-center-file-icon tone-file"><i class="fa-regular fa-file" aria-hidden="true"></i></span></div>
                                <div class="file-center-card-name"><i v-if="file.pin" class="fa-solid fa-thumbtack workspace-detail-pin-icon" aria-hidden="true"></i>{{ file.title || file.original_name || file.alias || file.file_ref }}</div>
                                <div class="workspace-file-card-meta">{{ visibilityLabel(file.visibility) }}</div>
                            </div>
                        </div>
                    </section>

                    <!-- 任务 -->
                    <section v-show="detailTab === 'tasks'" class="workspace-detail-panel" :class="{ active: detailTab === 'tasks' }" data-workspace-detail-panel="tasks">
                        <div class="workspace-detail-panel-list">
                            <div class="workspace-tasks-panel">
                                <div class="workspace-tasks-toolbar">
                                    <div><h2>任务排期</h2><span>{{ detailTasks.length }} 个任务</span></div>
                                    <button class="workspace-task-create-btn" type="button" @click="handleAddTask"><i class="fa-solid fa-plus" aria-hidden="true"></i><span>新建任务</span></button>
                                </div>
                                <div class="workspace-task-list">
                                    <div v-if="!detailTasks.length" class="workspace-detail-empty">暂无任务</div>
                                    <div v-for="task in detailTasks" :key="String(task.task_id || task.title || '')" class="workspace-task-row is-todo">
                                        <span class="workspace-task-row-icon"><i class="fa-regular fa-circle-check" aria-hidden="true"></i></span>
                                        <span class="workspace-task-row-main"><strong>{{ task.title || '未命名任务' }}</strong><small>{{ taskStatusLabel(task.status) }} · {{ task.priority || '中' }}</small></span>
                                        <span class="workspace-task-status-pill is-todo">{{ taskStatusLabel(task.status) }}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <!-- 记忆 -->
                    <section v-show="detailTab === 'memory'" class="workspace-detail-panel" :class="{ active: detailTab === 'memory' }" data-workspace-detail-panel="memory">
                        <div class="workspace-detail-panel-list workspace-detail-memory">
                            <div v-if="!memoryContent" class="workspace-detail-empty">暂无记忆沉淀</div>
                            <div v-else class="workspace-detail-memory-markdown">
                                <MarkdownView :content="memoryContent" />
                            </div>
                        </div>
                    </section>
                </div>
        </div>
    </section>

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
                        <span class="workspace-resource-title">{{ String(file.original_name || file.file_name || file.alias || file.name || file.title || '未命名文件') }}</span>
                </button>
            </div>
        </Modal>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

    import type { CloudFileItem as FilesCenterCloudFileItem } from '@/api/files-center'
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
        /** 点击项目文件:复用 Files 统一详情视图 */
        'open-file': [file: FilesCenterCloudFileItem]
    }>()

    const props = defineProps<{
        open: boolean
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

    /** 是否为当前用户创建的 Workspace(控制分享/删除可用性);
     *  owner_username 存的是登录名(user.id),必须比对 userId 而非显示名 username */
    const isOwner = computed(() => {
        return String(detail.value?.owner_username || '') === String(userStore.userId || '')
    })

    watch(
        () => props.open,
        (opened) => {
            if (!opened) {
                return
            }

            void load()
        },
        { immediate: true }
    )

    onMounted(() => {
        document.addEventListener('click', hideResourceMenu)
        document.addEventListener('scroll', hideResourceMenu, true)
    })

    onBeforeUnmount(() => {
        document.removeEventListener('click', hideResourceMenu)
        document.removeEventListener('scroll', hideResourceMenu, true)
    })

    /** 是否当前用户创建(对齐原版 owner_username 与 user.id 比对);
     *  不能比对 userStore.username(显示名),否则创建/共享会归类错误 */
    function isOwned(workspace: WorkspaceSummary): boolean {
        return String(workspace.owner_username || '') === String(userStore.userId || '')
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

    /** 将 Workspace 文件标记转换为 Files 详情所需的统一文件模型。 */
    function openWorkspaceFile(file: WorkspaceFileEntry): void {
        emit('open-file', {
            alias: String(file.alias || file.file_ref || ''),
            name: String(file.title || file.original_name || file.alias || file.file_ref || ''),
            original_name: String(file.title || file.original_name || file.alias || file.file_ref || ''),
            sandbox_path: String(file.file_ref || file.alias || ''),
            size: Number(file.size || 0),
            updated_at: Number(file.updated_at || 0),
        })
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

    /** 暴露给父级(ChatView 顶栏返回):详情页返回列表、查询是否处于详情内容 */
    defineExpose({
        backToList(): void {
            detail.value = null
        },

        isInDetail(): boolean {
            return detail.value !== null
        },
    })
</script>
