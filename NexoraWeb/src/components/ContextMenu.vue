<!--
    ContextMenu.vue — 会话/知识库右键菜单(逐像素复刻原版 pin-context-menu)

    结构(与原版 chat.html #pinContextMenu 一致):
      置顶/解除置顶 + 修改标题(仅会话) + 归入工作区(子菜单,含已归入打勾)
    目标类型:
      - conversation    -> 置顶走 /api/conversations/<id>/pin,归入走 /api/workspace/<id>/conversations
      - knowledge_basis -> 置顶走 /api/knowledge/basis/<title>/pin,归入走 /api/workspace/<id>/knowledge
      - cloud_file      -> 无置顶;归入走 /api/workspace/<id>/files,已归入时可取消归入(移除文件标记)
    可见性:父级 armed + 浮层协调器 popoverId 互斥;打开时注册容器支持外部点击关闭。
    子菜单:由原版 CSS hover/focus 显示(与交互一致),JS 仅负责加载工作区数据。
    每次打开都重新拉取 include_marks 工作区列表,保证已归入打勾实时刷新。
-->

<template>
    <Teleport to="body">
        <div
            ref="rootEl"
            id="pinContextMenu"
            class="pin-context-menu"
            :class="{ active: visible, 'submenu-left': submenuLeft }"
            :style="{ left: `${posX}px`, top: `${posY}px` }"
            aria-hidden="false"
        >
            <button id="pinContextMenuAction" v-if="targetType !== 'cloud_file'" type="button" @click="handleTogglePin">
                <i class="fa-solid fa-thumbtack" aria-hidden="true"></i>
                <span>{{ pinned ? '解除置顶' : '置顶' }}</span>
            </button>
            <template v-if="targetType === 'cloud_file'">
                <button id="pinContextMenuFileDownload" type="button" @click="handleDownloadFile">
                    <i class="fa-solid fa-download" aria-hidden="true"></i>
                    <span>下载</span>
                </button>
                <button id="pinContextMenuFileDelete" class="pin-context-danger" type="button" @click="handleDeleteFile">
                    <i class="fa-solid fa-trash" aria-hidden="true"></i>
                    <span>删除文件</span>
                </button>
            </template>
            <button v-if="targetType === 'conversation'" id="pinContextMenuRename" type="button" @click="handleRename">
                <i class="fa-solid fa-pen" aria-hidden="true"></i>
                <span>修改标题</span>
            </button>
            <button v-if="showBranchEntry" id="pinContextMenuBranch" type="button" @click="handleViewBranchSource">
                <i class="fa-solid fa-code-branch" aria-hidden="true"></i>
                <span>查看分支处</span>
            </button>
            <button v-if="targetType === 'knowledge_basis'" id="pinContextMenuBasisDelete" class="pin-context-danger" type="button" @click="handleDeleteBasis">
                <i class="fa-solid fa-trash" aria-hidden="true"></i>
                <span>删除知识库</span>
            </button>
            <div id="pinContextMenuWorkspaceWrap" class="pin-context-submenu-wrap">
                <button
                    id="pinContextMenuWorkspace"
                    type="button"
                    @mouseenter="ensureWorkspaceItems"
                    @click="ensureWorkspaceItems"
                >
                    <i class="fa-regular fa-folder-open" aria-hidden="true"></i>
                    <span>归入工作区</span>
                    <i class="fa-solid fa-chevron-right pin-context-submenu-arrow" aria-hidden="true"></i>
                </button>
                <div id="pinContextMenuWorkspaceList" class="pin-context-submenu pin-context-workspace-list">
                    <div v-if="loadingWorkspaces" class="pin-context-submenu-empty">加载中...</div>
                    <div v-else-if="!workspaces.length" class="pin-context-submenu-empty">暂无工作区</div>
                    <button
                        v-for="workspace in workspaces"
                        :key="workspace.workspace_id"
                        class="pin-context-workspace-item"
                        :class="{ 'is-marked': isMarked(workspace) }"
                        :aria-pressed="isMarked(workspace) ? 'true' : 'false'"
                        type="button"
                        @click="handleAddToWorkspace(workspace.workspace_id)"
                    >
                        <i class="fa-regular fa-folder" aria-hidden="true"></i>
                        <span class="pin-context-workspace-title">{{ workspace.title || 'Untitled Workspace' }}</span>
                        <span v-if="isMarked(workspace)" class="pin-context-workspace-state">
                            <i class="fa-solid fa-check" aria-hidden="true"></i>
                            <span>已标记</span>
                        </span>
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
    import { computed, nextTick, ref, watch } from 'vue'

    import { setConversationPin, updateConversationTitle } from '@/api/conversations'
    import type { ConversationBranch } from '@/api/conversations'
    import { setBasisKnowledgePin } from '@/api/knowledge'
    import type { WorkspaceSummary, WorkspaceFileEntry } from '@/api/workspaces'
    import {
        addWorkspaceFile,
        addWorkspaceKnowledge,
        listWorkspaces,
        removeWorkspaceConversation,
        removeWorkspaceFile,
        removeWorkspaceKnowledge,
    } from '@/api/workspaces'
    import { showPrompt } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'
    import { closePopover, openPopover, overlay } from '@/ui/overlay'

    const props = withDefaults(defineProps<{
        /** 父级打开状态:菜单显示需 armed 且浮层协调器当前打开本菜单的 popoverId */
        armed: boolean
        x: number
        y: number
        /** 浮层协调器菜单 id(不同来源菜单用不同 id,保证互斥与各自 armed 清理) */
        popoverId?: string
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
        popoverId: 'context-menu',
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

    const rootEl = ref<HTMLElement | null>(null)

    /** 归入工作区数据(每次打开菜单重新拉取,保证已归入标记实时) */
    const loadingWorkspaces = ref(false)
    const workspaces = ref<WorkspaceSummary[]>([])

    /** 钳制后的菜单位置(避免超出视口) */
    const posX = ref(props.x)
    const posY = ref(props.y)

    /** 子菜单是否向左弹出(靠近右边缘时,对齐原版 positionPinContextSubmenu) */
    const submenuLeft = ref(false)

    /** 右键菜单可见:父级 armed 且浮层协调器互斥到本菜单 id */
    const visible = computed(() => props.armed && overlay.popover === props.popoverId)

    /** 是否显示"查看分支处":会话目标且带完整分支信息(对齐原版 branchBtn 显示条件) */
    const showBranchEntry = computed(() => {
        const branch = props.branch && typeof props.branch === 'object' ? props.branch : null

        return props.targetType === 'conversation' && !!branch && !!branch.parent_conversation_id
    })

    /** 查看分支处:通知父级跳转到父会话的分支消息(对齐原版 viewConversationBranchSourceFromContextMenu) */
    function handleViewBranchSource(): void {
        const branch = props.branch && typeof props.branch === 'object' ? props.branch : null

        if (!branch || !branch.parent_conversation_id) {
            return
        }

        closePopover(props.popoverId)

        emit('view-branch-source', branch)
    }

    /** 打开时:注册容器(外部点击关闭)、刷新工作区标记、钳制位置;flush post 确保 Teleport 节点已挂载。
     *  immediate 覆盖 v-if 首次挂载场景(如知识库菜单):挂载时 armed/x/y 已是最终值,
     *  无 immediate 则 watch 感知不到变化,首次右键无法钳制到视口内 */
    watch(
        [() => props.x, () => props.y, () => props.armed],
        () => {
            if (props.armed && overlay.popover === props.popoverId) {
                void onOpen()
            }
        },
        { flush: 'post', immediate: true }
    )

    /** 菜单打开收尾流程(对齐原版 showPinContextMenu:注册容器 + 加载工作区 + 定位) */
    async function onOpen(): Promise<void> {
        posX.value = props.x
        posY.value = props.y

        openPopover(props.popoverId, rootEl.value, { keepPanel: props.keepPanel })

        workspaces.value = []
        void ensureWorkspaceItems()

        await nextTick()

        positionMenu()
        positionSubmenu()

        // 浏览器首帧布局后再校验一次,确保菜单真正渲染后仍在视口内(防测量时序导致的溢出)
        requestAnimationFrame(() => {
            positionMenu()
            positionSubmenu()
        })
    }

    /** 钳制菜单到视口内(按实际渲染尺寸,对齐原版 left/top 边界计算) */
    function positionMenu(): void {
        if (!rootEl.value) {
            return
        }

        const rect = rootEl.value.getBoundingClientRect()
        const menuWidth = rect.width || rootEl.value.offsetWidth || 170
        const menuHeight = rect.height || rootEl.value.offsetHeight || 90

        posX.value = Math.min(Math.max(8, posX.value), Math.max(8, window.innerWidth - menuWidth - 12))
        posY.value = Math.min(Math.max(8, posY.value), Math.max(8, window.innerHeight - menuHeight - 12))
    }

    /** 靠近右边缘时子菜单向左弹出,避免溢出屏幕(子菜单数据加载完成后会再次校准) */
    function positionSubmenu(): void {
        if (!rootEl.value) {
            return
        }

        const menuWidth = rootEl.value.offsetWidth || 170
        const submenuEl = rootEl.value.querySelector('.pin-context-submenu') as HTMLElement | null
        const submenuWidth = (submenuEl ? submenuEl.offsetWidth : 0) || 190

        submenuLeft.value = posX.value + menuWidth + submenuWidth + 24 > window.innerWidth
    }

    /** 子菜单数据加载完成后再校准左右弹出方向(此时子菜单宽度才稳定) */
    watch(loadingWorkspaces, (loading) => {
        if (!loading) {
            positionSubmenu()
        }
    })

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

    /** 该目标是否已归入指定工作区(对齐原版 isWorkspaceMarkedForPinTarget) */
    function isMarked(workspace: WorkspaceSummary): boolean {
        if (props.targetType === 'knowledge_basis') {
            return workspaceHasMarkedKnowledge(workspace, props.title)
        }

        if (props.targetType === 'cloud_file') {
            return workspaceHasMarkedFile(workspace, props.fileRef, props.fileAlias)
        }

        return workspaceHasMarkedConversation(workspace, props.conversationId)
    }

    /** 云端文件已归入判断:工作区文件标记按 file_ref / alias / 传入别名三者任一匹配(镜像 workspaceHasMarkedConversation) */
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

    /** 会话已归入判断(对齐原版 workspaceHasMarkedConversation) */
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

    /** 知识库已归入判断(对齐原版 workspaceHasMarkedKnowledge) */
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

    /** 云端文件已归入标记条目(取消归入时需要其 file_ref 定位后端标记) */
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

    /** 归入/取消归入工作区(再次点击已归入的工作区则移除;对齐原版 isMarked 标记) */
    async function handleAddToWorkspace(workspaceId: string): Promise<void> {
        if (!workspaceId) {
            return
        }

        const workspace = workspaces.value.find((entry) => entry.workspace_id === workspaceId)

        if (!workspace) {
            return
        }

        const removing = isMarked(workspace)

        closePopover(props.popoverId)

        try {
            if (props.targetType === 'cloud_file') {
                const ref = String(props.fileRef || '').trim()

                if (!ref) {
                    return
                }

                if (removing) {
                    const marker = findMarkedFile(workspace)

                    await removeWorkspaceFile(workspaceId, marker?.file_ref || ref)
                    showToast('已取消归入', 'success')
                } else {
                    await addWorkspaceFile(workspaceId, ref)
                    showToast('已归入 Workspace', 'success')
                }

                return
            }

            if (props.targetType === 'knowledge_basis') {
                if (removing) {
                    await removeWorkspaceKnowledge(workspaceId, props.title)
                    showToast('已取消归入', 'success')
                } else {
                    await addWorkspaceKnowledge(workspaceId, props.title)
                    showToast('已归入 Workspace', 'success')
                }

                return
            }

            const conversationId = props.conversationId

            if (!conversationId) {
                return
            }

            if (removing) {
                await removeWorkspaceConversation(workspaceId, conversationId)
                showToast('已取消归入', 'success')

                return
            }

            const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceId)}/conversations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ conversation_id: conversationId }),
            })

            const data = await res.json()

            if (!res.ok || !data.success) {
                throw new Error((data && data.message) || '对话归入 Workspace 失败')
            }

            showToast('已归入 Workspace', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '操作失败')
        }
    }

    /** 置顶/解除置顶(会话走 conversations pin,知识库走 basis pin) */
    async function handleTogglePin(): Promise<void> {
        const nextPin = !props.pinned

        closePopover(props.popoverId)

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

    /** 云端文件:下载/删除意图转发宿主(确认与执行由宿主完成,镜像 handleDeleteBasis 模式) */
    function handleDownloadFile(): void {
        if (props.targetType !== 'cloud_file') {
            return
        }

        closePopover(props.popoverId)

        emit('download-file')
    }

    function handleDeleteFile(): void {
        if (props.targetType !== 'cloud_file') {
            return
        }

        closePopover(props.popoverId)

        emit('request-delete-file')
    }

    /** 删除知识库:仅通知父级(确认/删除/刷新由父级 KnowledgePanel 完成,避免菜单卸载后事件丢失) */
    function handleDeleteBasis(): void {
        const title = props.title

        if (!title) {
            return
        }

        closePopover(props.popoverId)

        emit('request-delete-basis', title)
    }

    /** 修改标题(仅会话;自建输入小窗,对齐原版 rename modal 行为) */
    async function handleRename(): Promise<void> {
        const conversationId = props.conversationId

        if (!conversationId) {
            return
        }

        closePopover(props.popoverId)

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
