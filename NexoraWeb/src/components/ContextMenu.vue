<!--
    ContextMenu.vue — 会话/知识库/云端文件右键菜单(基于 GDDP ui/ContextMenu)

    业务动作(置顶 / 改名 / 归入工作区 / 删除等)保持不变,菜单容器、视口钳制、
    外部点击关闭与暗色视觉统一收敛到 GDDP ContextMenu:
      - 菜单项经 items 配置渲染(危险态 / 分隔线 / 子菜单由 key 驱动)
      - "归入工作区"异步子菜单经 #submenu-workspace slot 注入
      - 命令式范式:宿主在 contextmenu 事件里设置目标 props 后调用 open(x, y),
        关闭由 GDDP 容器(外部点击/选中项)自动完成

    目标类型:
      - conversation    -> 置顶走 /api/conversations/<id>/pin,归入走 /api/workspace/<id>/conversations
      - knowledge_basis -> 置顶走 /api/knowledge/basis/<title>/pin,归入走 /api/workspace/<id>/knowledge
      - cloud_file      -> 无置顶;归入走 /api/workspace/<id>/files,已归入时可取消归入
-->

<template>
    <ContextMenu
        ref="gddpRef"
        :items="menuItems"
        :keep-panel="keepPanel"
        @select="onSelect"
    >
        <template #submenu-workspace>
            <div v-if="loadingWorkspaces" class="gddp-context-submenu-empty">加载中...</div>
            <div v-else-if="!workspaces.length" class="gddp-context-submenu-empty">暂无工作区</div>
            <button
                v-for="workspace in workspaces"
                :key="workspace.workspace_id"
                class="gddp-context-item gddp-context-workspace-item"
                :class="{ 'is-marked': isMarked(workspace) }"
                type="button"
                @click="handleAddToWorkspace(workspace.workspace_id)"
            >
                <i class="fa-regular fa-folder" aria-hidden="true"></i>
                <span class="gddp-context-label">{{ workspace.title || 'Untitled Workspace' }}</span>
                <span v-if="isMarked(workspace)" class="gddp-context-workspace-state">
                    <i class="fa-solid fa-check" aria-hidden="true"></i>
                    <span>已标记</span>
                </span>
            </button>
        </template>
    </ContextMenu>
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import { setConversationPin, updateConversationTitle } from '@/api/conversations'
    import type { ConversationBranch } from '@/api/conversations'
    import { setBasisKnowledgePin } from '@/api/knowledge'
    import type { WorkspaceSummary, WorkspaceFileEntry } from '@/api/workspaces'
    import {
        addWorkspaceConversation,
        addWorkspaceFile,
        addWorkspaceKnowledge,
        listWorkspaces,
        removeWorkspaceConversation,
        removeWorkspaceFile,
        removeWorkspaceKnowledge,
    } from '@/api/workspaces'
    import { showPrompt } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'
    import { notifyWorkspaceChanged } from '@/stores/workspace'
    import ContextMenu, { type ContextMenuItem } from '@/ui/ContextMenu.vue'

    const props = withDefaults(defineProps<{
        /** 目标类型:会话 / 知识库 / 云端文件(默认会话) */
        targetType?: 'conversation' | 'knowledge_basis' | 'cloud_file'
        /** 会话目标 id(知识库目标为空) */
        conversationId?: string
        /** 云端文件目标:文件引用(sandbox_path 优先)与别名(用于工作区已归入标记匹配) */
        fileRef?: string
        fileAlias?: string
        title: string
        pinned: boolean
        /** 会话分支信息(仅分支会话显示"查看分支处"入口) */
        branch?: ConversationBranch
        /** 打开时保留右侧栏面板(面板内触发的右键菜单,如知识库面板) */
        keepPanel?: boolean
    }>(), {
        targetType: 'conversation',
        conversationId: '',
        fileRef: '',
        fileAlias: '',
        branch: undefined,
        keepPanel: false,
    })

    const emit = defineEmits<{
        'pin-changed': [targetType: string, id: string, pinned: boolean]
        'title-changed': [conversationId: string, title: string]
        'request-delete-basis': [title: string]
        'view-branch-source': [branch: ConversationBranch]
        /** 云端文件目标:下载 / 删除(确认与执行由宿主完成,菜单先关闭) */
        'download-file': []
        'request-delete-file': []
    }>()

    const gddpRef = ref<InstanceType<typeof ContextMenu> | null>(null)

    /** 归入工作区数据(每次打开菜单重新拉取,保证已归入标记实时) */
    const loadingWorkspaces = ref(false)
    const workspaces = ref<WorkspaceSummary[]>([])

    /** 是否显示"查看分支处":会话目标且带完整分支信息 */
    const showBranchEntry = computed(() => {
        const branch = props.branch && typeof props.branch === 'object' ? props.branch : null

        return props.targetType === 'conversation' && !!branch && !!branch.parent_conversation_id
    })

    /** 菜单项:按目标类型拼装(危险态 / 子菜单由 key 驱动) */
    const menuItems = computed<ContextMenuItem[]>(() => {
        const items: ContextMenuItem[] = []

        if (props.targetType !== 'cloud_file') {
            items.push({
                key: 'pin',
                label: props.pinned ? '解除置顶' : '置顶',
                icon: 'fa-solid fa-thumbtack',
            })
        }

        if (props.targetType === 'cloud_file') {
            items.push({ key: 'download', label: '下载', icon: 'fa-solid fa-download' })
            items.push({ key: 'delete-file', label: '删除文件', icon: 'fa-solid fa-trash', danger: true })
        }

        if (props.targetType === 'conversation') {
            items.push({ key: 'rename', label: '修改标题', icon: 'fa-solid fa-pen' })
        }

        if (showBranchEntry.value) {
            items.push({ key: 'branch', label: '查看分支处', icon: 'fa-solid fa-code-branch' })
        }

        if (props.targetType === 'knowledge_basis') {
            items.push({ key: 'delete-basis', label: '删除知识库', icon: 'fa-solid fa-trash', danger: true })
        }

        // 归入工作区子菜单(所有目标类型通用)
        items.push({
            key: 'workspace',
            label: '归入工作区',
            icon: 'fa-regular fa-folder-open',
            submenuKey: 'workspace',
        })

        return items
    })

    /** 命令式打开(宿主在 contextmenu 事件里调用):注册浮层并拉取最新工作区标记 */
    function open(x: number, y: number): void {
        gddpRef.value?.open(x, y)
        workspaces.value = []
        void ensureWorkspaceItems()
    }

    /** 命令式关闭 */
    function close(): void {
        gddpRef.value?.close()
    }

    defineExpose({ open, close })

    /** 拉取工作区列表(include_marks 带回已归入标记;每次打开都重新拉取) */
    async function ensureWorkspaceItems(): Promise<void> {
        if (loadingWorkspaces.value) {
            return
        }

        loadingWorkspaces.value = true

        try {
            workspaces.value = await listWorkspaces()
        } catch (error) {
            showError(error instanceof Error ? error.message : '工作区加载失败')
        } finally {
            loadingWorkspaces.value = false
        }
    }

    /** 该目标是否已归入指定工作区 */
    function isMarked(workspace: WorkspaceSummary): boolean {
        if (props.targetType === 'knowledge_basis') {
            return workspaceHasMarkedKnowledge(workspace, props.title)
        }

        if (props.targetType === 'cloud_file') {
            return workspaceHasMarkedFile(workspace, props.fileRef, props.fileAlias)
        }

        return workspaceHasMarkedConversation(workspace, props.conversationId)
    }

    function workspaceHasMarkedFile(workspace: WorkspaceSummary, fileRef: string, fileAlias: string): boolean {
        const ref = String(fileRef || '').trim()
        const alias = String(fileAlias || '').trim()

        if ((!ref && !alias) || !workspace) {
            return false
        }

        const files = Array.isArray(workspace.workspace_files) ? workspace.workspace_files : []

        return files.some((item) => {
            if (!item || typeof item !== 'object') {
                return false
            }

            const markerRef = String(item.file_ref || '').trim()
            const markerAlias = String(item.alias || '').trim()

            return (
                (ref && (markerRef === ref || markerAlias === ref))
                || (alias && markerAlias === alias)
            )
        })
    }

    function workspaceHasMarkedConversation(workspace: WorkspaceSummary, conversationId: string): boolean {
        const cid = String(conversationId || '').trim()

        if (!cid || !workspace) {
            return false
        }

        const ids = Array.isArray(workspace.conversation_ids) ? workspace.conversation_ids : []

        if (ids.some((item) => String(item || '').trim() === cid)) {
            return true
        }

        const conversations = Array.isArray(workspace.conversations) ? workspace.conversations : []

        return conversations.some((item) => {
            if (!item || typeof item !== 'object') {
                return false
            }

            return String(item.conversation_id || '').trim() === cid
        })
    }

    function workspaceHasMarkedKnowledge(workspace: WorkspaceSummary, title: string): boolean {
        const safeTitle = String(title || '').trim()

        if (!safeTitle || !workspace) {
            return false
        }

        const documents = Array.isArray(workspace.knowledge_documents) ? workspace.knowledge_documents : []

        return documents.some((item) => {
            if (!item || typeof item !== 'object') {
                return false
            }

            return String(item.title || '').trim() === safeTitle
        })
    }

    function findMarkedFile(workspace: WorkspaceSummary): WorkspaceFileEntry | null {
        const ref = String(props.fileRef || '').trim()
        const alias = String(props.fileAlias || '').trim()
        const files = Array.isArray(workspace.workspace_files) ? workspace.workspace_files : []

        for (const item of files) {
            if (!item || typeof item !== 'object') {
                continue
            }

            const markerRef = String(item.file_ref || '').trim()
            const markerAlias = String(item.alias || '').trim()

            if (
                (ref && (markerRef === ref || markerAlias === ref))
                || (alias && markerAlias === alias)
            ) {
                return item as WorkspaceFileEntry
            }
        }

        return null
    }

    /** 归入 / 取消归入工作区(再次点击已归入的工作区则移除) */
    async function handleAddToWorkspace(workspaceId: string): Promise<void> {
        if (!workspaceId) {
            return
        }

        const workspace = workspaces.value.find((entry) => entry.workspace_id === workspaceId)

        if (!workspace) {
            return
        }

        const removing = isMarked(workspace)

        let changed = false

        // 注意:分支内严禁提前 return,否则会跳过 try 之后的同步与广播
        try {
            if (props.targetType === 'cloud_file') {
                const ref = String(props.fileRef || '').trim()

                if (ref) {
                    if (removing) {
                        const marker = findMarkedFile(workspace)

                        await removeWorkspaceFile(workspaceId, marker?.file_ref || ref)
                        showToast('已取消归入', 'success')
                    } else {
                        await addWorkspaceFile(workspaceId, ref)
                        showToast('已归入 Workspace', 'success')
                    }

                    changed = true
                }
            } else if (props.targetType === 'knowledge_basis') {
                if (removing) {
                    await removeWorkspaceKnowledge(workspaceId, props.title)
                    showToast('已取消归入', 'success')
                } else {
                    await addWorkspaceKnowledge(workspaceId, props.title)
                    showToast('已归入 Workspace', 'success')
                }

                changed = true
            } else if (props.conversationId) {
                if (removing) {
                    await removeWorkspaceConversation(workspaceId, props.conversationId)
                    showToast('已取消归入', 'success')
                } else {
                    await addWorkspaceConversation(workspaceId, props.conversationId)
                    showToast('已归入 Workspace', 'success')
                }

                changed = true
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : '操作失败')
        }

        if (!changed) {
            return
        }

        // 成功后立即同步本菜单的"已标记"并广播变更,让打开中的 Workspaces 页面同步刷新
        syncWorkspaceMark(workspace, removing)
        notifyWorkspaceChanged()
    }

    /**
     * 归入状态变更后本地即时同步对应工作区的标记数据:
     * 不重开菜单即可看到"已标记"翻转;仅改动内存副本,下次打开菜单仍会全量重拉。
     */
    function syncWorkspaceMark(workspace: WorkspaceSummary, removing: boolean): void {
        const index = workspaces.value.findIndex((entry) => entry.workspace_id === workspace.workspace_id)

        if (index < 0) {
            return
        }

        const next: WorkspaceSummary = { ...workspaces.value[index] }

        if (props.targetType === 'cloud_file') {
            const files = Array.isArray(next.workspace_files) ? [...next.workspace_files] : []

            next.workspace_files = removing
                ? files.filter((item) => item !== findMarkedFile(workspace))
                : [...files, { file_ref: String(props.fileRef || '').trim(), alias: props.fileAlias || undefined }]
        } else if (props.targetType === 'knowledge_basis') {
            const documents = Array.isArray(next.knowledge_documents) ? [...next.knowledge_documents] : []
            const markedTitle = props.title.trim()

            next.knowledge_documents = removing
                ? documents.filter((item) => String(item.title || '').trim() !== markedTitle)
                : [...documents, { title: props.title }]
        } else {
            const ids = Array.isArray(next.conversation_ids) ? [...next.conversation_ids] : []
            const conversations = Array.isArray(next.conversations) ? [...next.conversations] : []

            // conversation_ids 与 conversations 双数组都可能携带标记,取消时必须同时清理
            next.conversation_ids = removing ? ids.filter((id) => id !== props.conversationId) : [...ids, props.conversationId]
            next.conversations = removing ? conversations.filter((item) => item.conversation_id !== props.conversationId) : conversations
        }

        workspaces.value[index] = next
    }

    /** 按 key 分发到业务动作(GDDP 容器点击后已自动关闭菜单) */
    function onSelect(key: string): void {
        if (key === 'pin') {
            void handleTogglePin()

            return
        }

        if (key === 'rename') {
            void handleRename()

            return
        }

        if (key === 'branch') {
            handleViewBranchSource()

            return
        }

        if (key === 'workspace') {
            // 子菜单项自行处理,无需在此分发
            return
        }

        if (key === 'delete-basis') {
            handleDeleteBasis()

            return
        }

        if (key === 'download') {
            emit('download-file')

            return
        }

        if (key === 'delete-file') {
            emit('request-delete-file')
        }
    }

    /** 置顶 / 解除置顶(会话走 conversations pin,知识库走 basis pin) */
    async function handleTogglePin(): Promise<void> {
        const nextPin = !props.pinned

        try {
            if (props.targetType === 'knowledge_basis') {
                await setBasisKnowledgePin(props.title, nextPin)
                emit('pin-changed', 'knowledge_basis', props.title, nextPin)
                showToast(nextPin ? '已置顶' : '已取消置顶', 'success')
            } else {
                const conversationId = props.conversationId

                if (!conversationId) {
                    return
                }

                await setConversationPin(conversationId, nextPin)
                emit('pin-changed', 'conversation', conversationId, nextPin)
                showToast(nextPin ? '已置顶' : '已取消置顶', 'success')
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : '操作失败')
        }
    }

    function handleViewBranchSource(): void {
        const branch = props.branch && typeof props.branch === 'object' ? props.branch : null

        if (!branch || !branch.parent_conversation_id) {
            return
        }

        emit('view-branch-source', branch)
    }

    function handleDeleteBasis(): void {
        const title = props.title

        if (!title) {
            return
        }

        emit('request-delete-basis', title)
    }

    /** 修改标题(仅会话;自建输入小窗) */
    async function handleRename(): Promise<void> {
        const conversationId = props.conversationId

        if (!conversationId) {
            return
        }

        const nextTitle = await showPrompt({
            title: '修改标题',
            label: '会话标题',
            defaultValue: props.title,
            confirmText: '保存',
            cancelText: '取消',
        })

        if (nextTitle === null) {
            return
        }

        const title = nextTitle.trim()

        if (!title || title === props.title) {
            return
        }

        try {
            await updateConversationTitle(conversationId, title)

            emit('title-changed', conversationId, title)

            showToast('标题已更新', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '修改失败')
        }
    }
</script>
