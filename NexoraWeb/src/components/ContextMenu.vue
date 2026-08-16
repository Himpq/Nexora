<!--
    ContextMenu.vue — 会话右键菜单(逐像素复刻原版 pin-context-menu)

    结构(与原版 chat.html #pinContextMenu 一致):
      置顶/解除置顶 + 修改标题 + 归入工作区(子菜单,第 0 期占位)
-->

<template>
    <div
        id="pinContextMenu"
        class="pin-context-menu"
        :class="{ active: visible }"
        :style="{ left: `${x}px`, top: `${y}px` }"
        aria-hidden="false"
    >
        <button id="pinContextMenuAction" type="button" @click="handleTogglePin">
            <i class="fa-solid fa-thumbtack" aria-hidden="true"></i>
            <span>{{ pinned ? '解除置顶' : '置顶' }}</span>
        </button>
        <button id="pinContextMenuRename" type="button" @click="handleRename">
            <i class="fa-solid fa-pen" aria-hidden="true"></i>
            <span>修改标题</span>
        </button>
        <div id="pinContextMenuWorkspaceWrap" class="pin-context-submenu-wrap">
            <button
                id="pinContextMenuWorkspace"
                type="button"
                :aria-expanded="workspaceSubmenuOpen"
                @click="toggleWorkspaceSubmenu"
                @mouseenter="ensureWorkspaceItems"
            >
                <i class="fa-regular fa-folder-open" aria-hidden="true"></i>
                <span>归入工作区</span>
                <i class="fa-solid fa-chevron-right pin-context-submenu-arrow" aria-hidden="true"></i>
            </button>
            <div
                v-if="workspaceSubmenuOpen"
                id="pinContextMenuWorkspaceList"
                class="pin-context-submenu pin-context-workspace-list"
            >
                <div v-if="loadingWorkspaces" class="pin-context-submenu-empty">加载中...</div>
                <div v-else-if="!workspaces.length" class="pin-context-submenu-empty">暂无工作区</div>
                <button
                    v-for="workspace in workspaces"
                    :key="workspace.workspace_id"
                    class="pin-context-workspace-item"
                    type="button"
                    @click="handleAddToWorkspace(workspace.workspace_id)"
                >
                    <i class="fa-regular fa-folder" aria-hidden="true"></i>
                    <span class="pin-context-workspace-title">{{ workspace.title || 'Untitled Workspace' }}</span>
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import { setConversationPin, updateConversationTitle } from '@/api/conversations'
    import type { WorkspaceSummary } from '@/api/workspaces'
    import { listWorkspaces } from '@/api/workspaces'
    import { showPrompt } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'
    import { closePopover, overlay } from '@/ui/overlay'

    const props = defineProps<{
        x: number
        y: number
        conversationId: string
        title: string
        pinned: boolean
    }>()

    const emit = defineEmits<{
        'pin-changed': [conversationId: string, pinned: boolean]
        'title-changed': [conversationId: string, title: string]
    }>()

    /** 归入工作区子菜单状态(对齐原版 loadPinContextWorkspaceItems) */
    const workspaceSubmenuOpen = ref(false)
    const loadingWorkspaces = ref(false)
    const workspaces = ref<WorkspaceSummary[]>([])

    /** 右键菜单状态:由浮层协调器管理(打开即互斥,点击外部自动关闭) */
    const visible = computed(() => overlay.popover === 'context-menu')

    /** 切换子菜单;打开时若未加载则拉取工作区列表 */
    function toggleWorkspaceSubmenu(): void {
        workspaceSubmenuOpen.value = !workspaceSubmenuOpen.value

        if (workspaceSubmenuOpen.value && !workspaces.value.length) {
            void ensureWorkspaceItems()
        }
    }

    /** 确保工作区列表已加载(对齐原版 loadPinContextWorkspaceItems) */
    async function ensureWorkspaceItems(): Promise<void> {
        if (loadingWorkspaces.value || workspaces.value.length) {
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

    /** 将会话归入工作区(对齐原版 addConversationToWorkspace) */
    async function handleAddToWorkspace(workspaceId: string): Promise<void> {
        const conversationId = props.conversationId

        if (!conversationId || !workspaceId) {
            return
        }

        closePopover('context-menu')

        try {
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
            showError(error instanceof Error ? error.message : '归入失败')
        }
    }

    /** 置顶/解除置顶(对齐原版 PUT /api/conversations/<id>/pin) */
    async function handleTogglePin(): Promise<void> {
        const conversationId = props.conversationId

        if (!conversationId) {
            return
        }

        closePopover('context-menu')

        try {
            const nextPin = !props.pinned

            await setConversationPin(conversationId, nextPin)

            emit('pin-changed', conversationId, nextPin)

            showToast(nextPin ? '已置顶' : '已取消置顶', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '操作失败')
        }
    }

    /** 修改标题(自建输入小窗,对齐原版 rename modal 行为) */
    async function handleRename(): Promise<void> {
        const conversationId = props.conversationId

        if (!conversationId) {
            return
        }

        closePopover('context-menu')

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
