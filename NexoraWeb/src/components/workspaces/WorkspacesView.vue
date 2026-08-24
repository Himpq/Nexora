<!--
    WorkspacesView.vue — Workspaces 项目视图根组件

    职责:
      - 持有列表/详情/筛选/tab 等全部状态,是子树唯一的数据源
      - 实现 WorkspaceActions(注入给详情壳与面板):置顶/可见性/任务 CRUD/
        分享/上传/预览/新建知识库等全部副作用
      - 调度四个弹窗:分享 / 云端文件选择 / 文件预览 / 任务编辑
      - 打开对话时按归属分流:自己的会话直接打开,他人共享的会话
        以只读元数据交由宿主(ChatView)渲染共享视图

    对齐原版 openWorkspaceProjectsView 的完整交互;呈现由子组件承载。
-->

<template>
    <section v-if="!detail" class="workspace-projects-view" aria-label="Workspaces">
        <WorkspaceList
            v-model:query="query"
            v-model:filter="filter"
            :workspaces="filteredWorkspaces"
            :loading="loading"
            @create="handleCreate"
            @open="openDetail"
        />
    </section>

    <section v-else class="workspace-detail-view" aria-label="Workspace Detail">
        <WorkspaceDetail
            :key="detail.workspace_id"
            :workspace="detail"
            :tab="detailTab"
            @update:tab="detailTab = $event"
            @back="detail = null"
        />
    </section>

    <!-- 资源右键菜单(GDDP ContextMenu,命令式打开) -->
    <WorkspaceResourceMenu
        ref="resourceMenuRef"
        :pinned="resourceMenu.pinned"
        :show-remove="resourceMenu.showRemove"
        @confirm="confirmResourcePin"
        @remove="handleRemoveResource"
    />

    <!-- 分享弹窗 -->
    <WorkspaceShareModal
        :open="shareOpen"
        :workspace-id="detail?.workspace_id || ''"
        :shared-users="detail?.shared_users || []"
        :current-user-id="userStore.userId"
        :saving="shareSaving"
        @close="shareOpen = false"
        @save="saveShare"
    />

    <!-- 云端文件选择弹窗 -->
    <WorkspaceFilePickerModal
        :open="pickerOpen"
        :marked-refs="markedFileRefs"
        @close="pickerOpen = false"
        @pick="handlePickCloudFile"
    />

    <!-- 文件预览弹窗 -->
    <WorkspaceFilePreviewModal
        :open="previewOpen"
        :workspace-id="detail?.workspace_id || ''"
        :file="previewFile"
        @close="previewOpen = false"
    />

    <!-- 任务新建/编辑弹窗 -->
    <WorkspaceTaskModal
        :open="taskModal.open"
        :task="taskModal.task"
        :draft-date="taskModal.draftDate"
        :default-assignee="userStore.userId"
        :saving="taskSaving"
        @close="closeTaskModal"
        @submit="submitTask"
    />
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'

    import type { CloudFileItem } from '@/api/files-center'
    import { uploadFile } from '@/api/files-center'

    /** 组件 WorkspaceDetail.vue 与 API 类型同名,类型统一走别名 */
    import type { WorkspaceDetail as WorkspaceDetailData } from '@/api/workspaces'
    import type { WorkspaceFileEntry, WorkspaceSummary, WorkspaceTaskEntry, WorkspaceTaskPayload } from '@/api/workspaces'
    import {
        addWorkspaceFile,
        createBlankWorkspaceKnowledge,
        createWorkspace,
        createWorkspaceTask,
        deleteWorkspace as deleteWorkspaceApi,
        deleteWorkspaceTask,
        fetchWorkspace,
        listWorkspaces,
        pinWorkspaceConversation,
        pinWorkspaceFile,
        pinWorkspaceKnowledge,
        removeWorkspaceFile,
        updateConversationVisibility,
        updateFileVisibility,
        updateKnowledgeVisibility,
        updateWorkspaceSettings,
        updateWorkspaceTask,
    } from '@/api/workspaces'

    import { showConfirm, showPrompt } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'
    import { useUserStore } from '@/stores/user'

    import WorkspaceList from './WorkspaceList.vue'
    import WorkspaceDetail from './WorkspaceDetail.vue'
    import WorkspaceResourceMenu from './WorkspaceResourceMenu.vue'
    import WorkspaceShareModal from './modals/WorkspaceShareModal.vue'
    import WorkspaceFilePickerModal from './modals/WorkspaceFilePickerModal.vue'
    import WorkspaceFilePreviewModal from './modals/WorkspaceFilePreviewModal.vue'
    import WorkspaceTaskModal from './modals/WorkspaceTaskModal.vue'
    import {
        WORKSPACE_ACTIONS_KEY,
        WORKSPACE_VISIBILITY_SAVING_KEY,
        type WorkspaceActions,
        type WorkspaceConversationOpenMeta,
        type WorkspaceDetailTab,
        type WorkspaceResourceRef,
        type WorkspaceTaskDraftOptions,
    } from './workspaceContext'
    import { resourceRowKey } from './workspaceResource'

    const emit = defineEmits<{
        /** 点击项目内对话:自己的会话直接打开;他人共享会话附带归属元数据走只读视图 */
        'open-conversation': [conversationId: string, meta?: WorkspaceConversationOpenMeta]
        /** 打开项目内知识库文档 */
        'open-knowledge': [title: string]
    }>()

    const props = defineProps<{
        open: boolean
    }>()

    const userStore = useUserStore()

    /** ===== 列表状态 ===== */
    const loading = ref(false)
    const workspaces = ref<WorkspaceSummary[]>([])
    const query = ref('')
    const filter = ref<'all' | 'owned' | 'shared'>('all')

    /** ===== 详情状态 ===== */
    const detail = ref<WorkspaceDetailData | null>(null)
    const detailTab = ref<WorkspaceDetailTab>('overview')

    /** 筛选 + 搜索后的列表(对齐原版 getFilteredWorkspaceProjects:标题或创建者匹配) */
    const filteredWorkspaces = computed(() => {
        const keyword = query.value.trim().toLowerCase()

        return workspaces.value.filter((workspace) => {
            const title = String(workspace.title || '').toLowerCase()
            const owner = String(workspace.owner_username || '').toLowerCase()
            const matchesQuery = !keyword || title.includes(keyword) || owner.includes(keyword)

            if (!matchesQuery) {
                return false
            }

            if (filter.value === 'owned') {
                return isOwned(workspace)
            }

            if (filter.value === 'shared') {
                return !isOwned(workspace)
            }

            return true
        })
    })

    /** 是否当前用户创建的 Workspace;
     *  owner_username 存的是登录名(user.id),必须比对 userId 而非显示名 username */
    function isOwned(workspace: WorkspaceSummary): boolean {
        return String(workspace.owner_username || '') === userStore.userId
    }

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

    /** 打开详情(对齐原版 selectWorkspaceProject) */
    async function openDetail(workspaceId: string): Promise<void> {
        try {
            detail.value = await fetchWorkspace(workspaceId)
            detailTab.value = 'overview'
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载项目失败')
        }
    }

    /** 详情更新后同步列表缓存中的对应项(对齐原版 syncWorkspaceProjectAfterDetailUpdate,避免整表重拉) */
    function syncListWithDetail(updated: WorkspaceDetailData): void {
        const index = workspaces.value.findIndex((item) => item.workspace_id === updated.workspace_id)

        if (index >= 0) {
            workspaces.value[index] = { ...workspaces.value[index], ...updated }
        }
    }

    /** 应用一次变更返回的最新详情 */
    function applyDetailUpdate(updated: WorkspaceDetailData | null): void {
        if (!updated) {
            return
        }

        detail.value = updated
        syncListWithDetail(updated)
    }

    /** 新建项目(名称走统一 prompt;长度上限对齐原版 maxlength=120) */
    async function handleCreate(): Promise<void> {
        const title = await showPrompt({
            title: '新建 Workspace',
            label: '名称',
            placeholder: '例如:日本之旅',
            confirmText: '创建',
            cancelText: '取消',
            maxlength: 120,
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

    /** ===== 注入动作实现 ===== */

    /** 资源类型中文名(置顶 toast 按类型区分文案,对齐原版) */
    const RESOURCE_NOUNS: Record<WorkspaceResourceRef['type'], string> = {
        conversation: '对话',
        knowledge: '知识库',
        file: '文件',
    }

    /** 可见性开关保存中的资源行键(空串表示空闲;开关据此显示 spinner 并禁点) */
    const visibilitySavingKey = ref('')

    /** 资源置顶/取消置顶(按类型分发到对应接口) */
    async function toggleResourcePin(target: WorkspaceResourceRef, nextPin: boolean): Promise<void> {
        if (!detail.value) {
            return
        }

        const noun = RESOURCE_NOUNS[target.type]

        try {
            if (target.type === 'conversation') {
                applyDetailUpdate(await pinWorkspaceConversation(detail.value.workspace_id, target.ref, nextPin))
            } else if (target.type === 'knowledge') {
                applyDetailUpdate(await pinWorkspaceKnowledge(
                    detail.value.workspace_id,
                    target.ref,
                    target.addedBy,
                    nextPin,
                    target.knowledgeType
                ))
            } else {
                applyDetailUpdate(await pinWorkspaceFile(detail.value.workspace_id, target.ref, target.addedBy, nextPin))
            }

            showToast(nextPin ? `Workspace ${noun}已置顶` : `Workspace ${noun}已取消置顶`, 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '置顶失败')
        }
    }

    /** 共享状态切换(private/share);请求期间标记保存中,防连点竞态 */
    async function toggleResourceVisibility(target: WorkspaceResourceRef, next: string): Promise<void> {
        if (!detail.value) {
            return
        }

        visibilitySavingKey.value = resourceRowKey(target)

        try {
            if (target.type === 'conversation') {
                applyDetailUpdate(await updateConversationVisibility(detail.value.workspace_id, target.ref, next))
            } else if (target.type === 'knowledge') {
                applyDetailUpdate(await updateKnowledgeVisibility(detail.value.workspace_id, target.ref, next, target.knowledgeType))
            } else {
                applyDetailUpdate(await updateFileVisibility(detail.value.workspace_id, target.ref, next))
            }

            showToast(next === 'share' ? '已设为共享' : '已设为私有', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '共享状态保存失败')
        } finally {
            visibilitySavingKey.value = ''
        }
    }

    /** ===== 右键菜单 ===== */
    interface ResourceMenuState {
        pinned: boolean
        target: WorkspaceResourceRef | null
        /** 是否显示「从 Workspace 移除」(仅自己添加的文件行) */
        showRemove: boolean
    }

    const resourceMenuRef = ref<InstanceType<typeof WorkspaceResourceMenu> | null>(null)

    const resourceMenu = ref<ResourceMenuState>({
        pinned: false,
        target: null,
        showRemove: false,
    })

    function openResourceMenu(event: MouseEvent, target: WorkspaceResourceRef): void {
        // 菜单定位与视口钳制交由 GDDP ContextMenu 负责;本组件仅预存置顶态与移除项可见性
        resourceMenu.value = {
            pinned: resolvePinned(target),
            target,
            // 文件标记只允许自己添加的行移出(后端按 actor 限定);对话/知识库的移出走主列表右键"取消归入"
            showRemove: target.type === 'file' && String(target.addedBy || '') === userStore.userId,
        }

        resourceMenuRef.value?.open(event.clientX, event.clientY)
    }

    /** 从当前详情推导资源置顶态,保证菜单文案准确 */
    function resolvePinned(target: WorkspaceResourceRef): boolean {
        if (!detail.value) {
            return false
        }

        if (target.type === 'conversation') {
            return Boolean(detail.value.conversations?.find((item) => item.conversation_id === target.ref && String(item.added_by || '') === target.addedBy)?.pin)
        }

        if (target.type === 'knowledge') {
            return Boolean(detail.value.knowledge_documents?.find((item) => item.title === target.ref && String(item.added_by || '') === target.addedBy)?.pin)
        }

        return Boolean(detail.value.workspace_files?.find((item) => item.file_ref === target.ref && String(item.added_by || '') === target.addedBy)?.pin)
    }

    /** 关闭资源右键菜单(GDDP ContextMenu 命令式关闭;外部点击由 overlay 统一处理) */
    function hideResourceMenu(): void {
        resourceMenuRef.value?.close()
    }

    async function confirmResourcePin(): Promise<void> {
        const target = resourceMenu.value.target
        const pinned = resourceMenu.value.pinned

        hideResourceMenu()

        if (!target) {
            return
        }

        await toggleResourcePin(target, !pinned)
    }

    /** 从 Workspace 移除文件标记(仅自己添加的行可移除,后端按 actor 限定) */
    async function handleRemoveResource(): Promise<void> {
        const target = resourceMenu.value.target
        const workspace = detail.value

        hideResourceMenu()

        if (!target || target.type !== 'file' || !workspace) {
            return
        }

        try {
            applyDetailUpdate(await removeWorkspaceFile(String(workspace.workspace_id || ''), target.ref))

            showToast('已从 Workspace 移除', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '移除失败')
        }
    }

    onMounted(() => {
        // 外部点击关闭由 GDDP ContextMenu 经 overlay 协调器统一保证,此处不再重复绑定 click
        document.addEventListener('scroll', hideResourceMenu, true)
        window.addEventListener('resize', hideResourceMenu)
    })

    onBeforeUnmount(() => {
        document.removeEventListener('scroll', hideResourceMenu, true)
        window.removeEventListener('resize', hideResourceMenu)
    })

    /** ===== 打开资源 ===== */

    /**
     * 打开项目内对话,按归属分流(对齐原版 openWorkspaceDetailConversation):
     *   - 自己添加 → 直接交宿主按普通会话打开
     *   - 他人添加 → 附带归属元数据,由宿主走只读共享视图
     */
    function openConversation(conversationId: string, addedBy = ''): void {
        const workspace = detail.value

        if (!workspace) {
            return
        }

        const owner = String(addedBy || workspace.owner_username || '').trim()

        if (!owner || owner === userStore.userId) {
            emit('open-conversation', conversationId)

            return
        }

        emit('open-conversation', conversationId, {
            workspaceId: workspace.workspace_id,
            workspaceTitle: String(workspace.title || ''),
            ownerUsername: owner,
        })
    }

    function openKnowledge(title: string): void {
        emit('open-knowledge', title)
    }

    /** 文件点击 → 内置预览弹窗(项目接口支持跨用户读取) */
    const previewOpen = ref(false)
    const previewFile = ref<WorkspaceFileEntry | null>(null)

    function openFile(file: WorkspaceFileEntry): void {
        previewFile.value = file
        previewOpen.value = true
    }

    /** ===== 云端文件选择 / 上传 ===== */
    const pickerOpen = ref(false)

    /** 已归入文件的标记集合(file_ref 与 alias 都算,对齐原版 workspaceHasMarkedFile) */
    const markedFileRefs = computed(() => {
        const files = Array.isArray(detail.value?.workspace_files) ? detail.value.workspace_files : []

        return files.flatMap((item) => [String(item.file_ref || ''), String(item.alias || '')]).filter(Boolean)
    })

    async function handlePickCloudFile(file: CloudFileItem): Promise<void> {
        if (!detail.value) {
            return
        }

        const fileRefPath = String(file.sandbox_path || file.alias || file.name || '').trim()

        if (!fileRefPath) {
            showToast('文件路径无效', 'warning')

            return
        }

        try {
            applyDetailUpdate(await addWorkspaceFile(detail.value.workspace_id, fileRefPath))

            showToast('文件已加入 Workspace', 'success')
            pickerOpen.value = false
        } catch (error) {
            showError(error instanceof Error ? error.message : '添加文件失败')
        }
    }

    const uploadingFiles = ref(false)

    /** 上传文件到 Workspace(目标目录 workspaces/<id>,成功后逐个归入) */
    async function uploadWorkspaceFiles(files: FileList | File[]): Promise<void> {
        if (!detail.value) {
            return
        }

        const list = Array.from(files)

        if (!list.length) {
            return
        }

        if (uploadingFiles.value) {
            showToast('已有文件上传任务,请先等待完成', 'warning')

            return
        }

        uploadingFiles.value = true

        let addedCount = 0

        try {
            for (const file of list) {
                try {
                    const result = await uploadFile(file, `workspaces/${detail.value.workspace_id}`)
                    const sandboxPath = String(result.sandbox_path || '').trim()

                    if (!sandboxPath) {
                        throw new Error('上传结果缺少文件路径')
                    }

                    applyDetailUpdate(await addWorkspaceFile(detail.value.workspace_id, sandboxPath))
                    addedCount += 1
                } catch (error) {
                    showError(`上传失败(${file.name}):${error instanceof Error ? error.message : '未知错误'}`)
                }
            }
        } finally {
            uploadingFiles.value = false

            if (addedCount > 0) {
                showToast(`已加入 ${addedCount} 个文件`, 'success')
            }
        }
    }

    /** ===== 分享弹窗 ===== */
    const shareOpen = ref(false)
    const shareSaving = ref(false)

    function openShareModal(): void {
        shareOpen.value = true
    }

    async function saveShare(users: string[]): Promise<void> {
        if (!detail.value) {
            return
        }

        shareSaving.value = true

        try {
            applyDetailUpdate(await updateWorkspaceSettings(detail.value.workspace_id, { shared_users: users }))

            showToast('分享设置已保存', 'success')
            shareOpen.value = false
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存失败')
        } finally {
            shareSaving.value = false
        }
    }

    /** ===== 详情级动作 ===== */

    async function renameWorkspace(title: string): Promise<boolean> {
        if (!detail.value) {
            return false
        }

        try {
            applyDetailUpdate(await updateWorkspaceSettings(detail.value.workspace_id, { title }))

            showToast('名称已保存', 'success')

            return true
        } catch (error) {
            showError(error instanceof Error ? error.message : '重命名失败')

            return false
        }
    }

    async function deleteWorkspace(): Promise<void> {
        if (!detail.value) {
            return
        }

        const confirmed = await showConfirm({
            title: '删除 Workspace',
            content: `确定删除「${detail.value.title}」吗?此操作不可恢复。`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            await deleteWorkspaceApi(detail.value.workspace_id)

            showToast('已删除', 'success')
            detail.value = null
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }

    /** 新建空白知识库并归入;成功后打开该文档(对齐原版行为) */
    async function createBlankKnowledge(titlePrefix: string): Promise<void> {
        if (!detail.value) {
            return
        }

        let prefix = titlePrefix.trim()

        if (!prefix) {
            const prompted = await showPrompt({
                title: '新建 Workspace 知识库',
                label: '知识库名称',
                placeholder: '例如:旅行攻略',
                confirmText: '创建',
                cancelText: '取消',
            })

            prefix = String(prompted || '').trim()

            if (!prefix) {
                return
            }
        }

        try {
            const result = await createBlankWorkspaceKnowledge(detail.value.workspace_id, prefix)

            if (!result.title) {
                throw new Error('空白知识库标题为空')
            }

            applyDetailUpdate(result.workspace)
            showToast('空白知识库已创建', 'success')
            emit('open-knowledge', result.title)
        } catch (error) {
            showError(error instanceof Error ? error.message : '空白知识库创建失败')
        }
    }

    /** ===== 任务 ===== */
    interface TaskModalState {
        open: boolean
        task: WorkspaceTaskEntry | null
        draftDate: string
    }

    const taskModal = ref<TaskModalState>({
        open: false,
        task: null,
        draftDate: '',
    })
    const taskSaving = ref(false)

    function editTask(task: WorkspaceTaskEntry | null, options?: WorkspaceTaskDraftOptions): void {
        taskModal.value = {
            open: true,
            task,
            draftDate: String(options?.date || options?.startDate || options?.dueDate || ''),
        }
    }

    function closeTaskModal(): void {
        taskModal.value.open = false
    }

    async function submitTask(payload: WorkspaceTaskPayload): Promise<void> {
        if (!detail.value) {
            return
        }

        const editing = taskModal.value.task
        const taskId = String(editing?.task_id || '')

        taskSaving.value = true

        try {
            const updated = taskId
                ? await updateWorkspaceTask(detail.value.workspace_id, taskId, payload)
                : await createWorkspaceTask(detail.value.workspace_id, payload)

            applyDetailUpdate(updated)

            showToast(taskId ? '任务已保存' : '任务已创建', 'success')
            detailTab.value = 'tasks'
            closeTaskModal()
        } catch (error) {
            showError(error instanceof Error ? error.message : '任务保存失败')
        } finally {
            taskSaving.value = false
        }
    }

    async function changeTaskStatus(task: WorkspaceTaskEntry, status: string): Promise<void> {
        if (!detail.value) {
            return
        }

        const taskId = String(task.task_id || '')

        if (!taskId) {
            return
        }

        try {
            applyDetailUpdate(await updateWorkspaceTask(detail.value.workspace_id, taskId, { status }))
            showToast('任务状态已更新', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '任务状态保存失败')
        }
    }

    async function removeTask(task: WorkspaceTaskEntry): Promise<void> {
        if (!detail.value) {
            return
        }

        const taskId = String(task.task_id || '')

        if (!taskId) {
            return
        }

        const confirmed = await showConfirm({
            title: '删除任务',
            content: `确定删除任务「${task.title || '未命名任务'}」吗?`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            applyDetailUpdate(await deleteWorkspaceTask(detail.value.workspace_id, taskId))
            showToast('任务已删除', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '任务删除失败')
        }
    }

    /** 动作集合:一次性组装后提供给子树 */
    const actions: WorkspaceActions = {
        currentUserId: () => userStore.userId,
        toggleResourcePin,
        toggleResourceVisibility,
        openResourceMenu,
        openConversation,
        openKnowledge,
        openFile,
        pickCloudFiles: () => {
            pickerOpen.value = true
        },
        uploadWorkspaceFiles,
        editTask,
        changeTaskStatus,
        removeTask,
        openShareModal,
        renameWorkspace,
        deleteWorkspace,
        createBlankKnowledge,
    }

    provide(WORKSPACE_ACTIONS_KEY, actions)
    provide(WORKSPACE_VISIBILITY_SAVING_KEY, visibilitySavingKey)

    /**
     * 暴露给宿主(ChatView):
     *   - backToList / isInDetail:顶栏返回的多级回退
     *   - composerTarget:详情页内嵌输入框的归入目标(workspace_id;空串=未在详情页)。
     *     是响应式引用,宿主据此驱动 Teleport 开关与顶栏「Workspace/Workspaces」标题
     */
    const composerTarget = computed(() => (detail.value ? detail.value.workspace_id : ''))

    defineExpose({
        backToList(): void {
            detail.value = null
        },

        isInDetail(): boolean {
            return detail.value !== null
        },

        /** 当前详情所在 Workspace id(空串表示不在详情页),供宿主回退定位 */
        currentWorkspaceId(): string {
            return detail.value ? String(detail.value.workspace_id || '') : ''
        },

        /** 详情页内嵌输入框归入目标;空串表示当前不在详情页 */
        composerTarget,
    })
</script>

<style scoped>
    /* 视图壳样式:滚动与背景由 .gddp-content-view 布局契约治理(gddp-layout.css),
       此处只补视图自身的内边距与底色。 */
    .workspace-projects-view {
        flex: 1;
        min-height: 0;
        overflow: auto;
        background: var(--color-bg-page);
        color: var(--color-text-primary);
        box-sizing: border-box;
        padding: 42px 40px 58px;
    }

    .workspace-detail-view {
        flex: 1;
        min-height: 0;
        overflow: auto;
        background: var(--color-bg-page);
        color: var(--color-text-primary);
    }

    @media (max-width: 1180px) {
        .workspace-projects-view {
            padding: 32px 24px 56px;
        }
    }

    @media (max-width: 720px) {
        .workspace-projects-view {
            padding: 28px 16px 42px;
        }
    }
</style>
