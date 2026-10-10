<template>
    <div class="permission-switcher nc-permission-switcher">
        <button
            ref="triggerRef"
            type="button"
            class="permission-switcher-trigger"
            :class="{ 'is-loading': loading || saving }"
            :data-mode="settings?.mode || ''"
            :style="activeOption ? { color: activeOption.color } : undefined"
            :aria-expanded="open"
            :aria-busy="loading"
            aria-haspopup="menu"
            :aria-label="triggerLabel"
            :title="triggerLabel"
            :disabled="saving"
            @click="toggleMenu"
            @keydown.esc="closeMenu"
        >
            <i v-if="activeOption" :class="['fa-solid', activeOption.icon]" aria-hidden="true"></i>
        </button>

        <Teleport to="body">
            <div
                v-if="open"
                ref="menuRef"
                class="permission-switcher-menu nc-permission-switcher-menu"
                role="menu"
                aria-label="工具权限"
                :style="menuPosition"
                @click.stop
                @keydown.esc="closeMenu"
            >
                <div class="permission-switcher-heading">工具权限</div>
                <p v-if="loading" class="permission-switcher-note" role="status">正在读取工具权限…</p>
                <button
                    v-for="option in options"
                    :key="option.id"
                    type="button"
                    class="permission-switcher-option"
                    :data-mode="option.id"
                    :style="{ '--permission-accent': option.color, '--permission-tint': option.tint }"
                    role="menuitemradio"
                    :aria-checked="settings?.mode === option.id"
                    :disabled="!settings || loading || saving || (option.id === 'auto' && !approvalModelId)"
                    @click="selectMode(option.id)"
                >
                    <span class="permission-switcher-option-icon" aria-hidden="true">
                        <i :class="['fa-solid', option.icon]"></i>
                    </span>
                    <span class="permission-switcher-option-copy">
                        <strong>{{ option.name }}</strong>
                        <small>{{ option.description }}</small>
                    </span>
                    <svg
                        v-if="settings?.mode === option.id"
                        class="permission-switcher-check"
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                    >
                        <path d="m4 10 4 4 8-8"></path>
                    </svg>
                </button>

                <p v-if="!loading && !approvalModelId" class="permission-switcher-note">
                    自动审批需要先在设置中选择审批模型。
                </p>
                <p v-if="error" class="permission-switcher-feedback" role="status">{{ error }}</p>
            </div>
        </Teleport>
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

    import {
        fetchLocalConversationSettings,
        fetchLocalPermissionSettings,
        saveLocalConversationSettings,
        saveLocalPermissionSettings,
        type LocalPermissionMode,
        type LocalPermissionSettings,
    } from '@/api/nexoracodeLocal'
    import {
        fetchRemoteConversationSettings,
        fetchRemotePermissionSettings,
        saveRemoteConversationSettings,
        saveRemotePermissionSettings,
    } from '@/api/nexoracode'
    import { showToast } from '@/stores/notify'

    const props = defineProps<{
        selectedModelId: string
        remoteDeviceId?: string
        /** 当前会话 id：本地形态下权限按会话独立保存，缺省时退回全局默认。 */
        conversationId?: string
    }>()

    const emit = defineEmits<{
        ready: [ready: boolean]
        changed: [mode: LocalPermissionMode]
    }>()

    const permissionOptions: Record<LocalPermissionMode, {
        id: LocalPermissionMode
        name: string
        description: string
        icon: string
        color: string
        tint: string
    }> = {
        read_only: {
            id: 'read_only',
            name: '只读',
            description: '只允许读取和查看信息',
            icon: 'fa-book-open',
            color: '#22c55e',
            tint: 'rgba(34, 197, 94, 0.12)',
        },
        confirm: {
            id: 'confirm',
            name: '写入 / 命令确认',
            description: '写入文件或执行命令前询问',
            icon: 'fa-eye',
            color: '#3b82f6',
            tint: 'rgba(59, 130, 246, 0.12)',
        },
        auto: {
            id: 'auto',
            name: '自动审批',
            description: '由设置中的模型判断每项操作',
            icon: 'fa-shield-halved',
            color: '#eab308',
            tint: 'rgba(234, 179, 8, 0.14)',
        },
        full: {
            id: 'full',
            name: '完全访问',
            description: '直接执行 Agent 工具操作',
            icon: 'fa-shield-halved',
            color: '#ef4444',
            tint: 'rgba(239, 68, 68, 0.12)',
        },
    }
    const options = Object.values(permissionOptions)

    const settings = ref<LocalPermissionSettings | null>(null)
    const open = ref(false)
    const loading = ref(false)
    const saving = ref(false)
    const error = ref('')
    const triggerRef = ref<HTMLButtonElement | null>(null)
    const menuRef = ref<HTMLDivElement | null>(null)
    const menuPosition = ref<Record<string, string>>({})
    let settingsRequestId = 0

    const approvalModelId = computed(() => {
        if (!settings.value) {
            return ''
        }

        const modelIds = new Set(settings.value.models.map((model) => model.id))

        if (settings.value.approval_model_id && modelIds.has(settings.value.approval_model_id)) {
            return settings.value.approval_model_id
        }

        return modelIds.has(props.selectedModelId) ? props.selectedModelId : ''
    })

    const activeOption = computed(() => {
        if (!settings.value) {
            return undefined
        }

        return permissionOptions[settings.value.mode]
    })

    const triggerLabel = computed(() => {
        if (!settings.value) {
            return error.value ? '工具权限读取失败' : '正在读取工具权限'
        }

        return '工具权限：' + permissionOptions[settings.value.mode].name
    })

    async function refreshSettings(): Promise<void> {
        const requestId = ++settingsRequestId
        const deviceId = String(props.remoteDeviceId || '').trim()
        const conversationId = String(props.conversationId || '').trim()
        loading.value = true
        error.value = ''

        try {
            let nextSettings: LocalPermissionSettings

            if (deviceId) {
                if (conversationId) {
                    // 云端形态：权限同样按会话独立保存；模型目录从全局接口取。
                    const [conversation, global] = await Promise.all([
                        fetchRemoteConversationSettings(deviceId, conversationId),
                        fetchRemotePermissionSettings(deviceId),
                    ])

                    nextSettings = {
                        mode: conversation.permission_mode,
                        approval_model_id: conversation.approval_model_id,
                        models: global.models,
                    }
                } else {
                    nextSettings = await fetchRemotePermissionSettings(deviceId)
                }
            } else if (conversationId) {
                // 本地形态：权限按会话独立保存；模型目录仍需从全局接口取。
                const [conversation, global] = await Promise.all([
                    fetchLocalConversationSettings(conversationId),
                    fetchLocalPermissionSettings(),
                ])

                nextSettings = {
                    mode: conversation.permission_mode,
                    approval_model_id: conversation.approval_model_id,
                    models: global.models,
                }
            } else {
                nextSettings = await fetchLocalPermissionSettings()
            }

            if (requestId !== settingsRequestId
                || deviceId !== String(props.remoteDeviceId || '').trim()
                || conversationId !== String(props.conversationId || '').trim()) {
                return
            }

            settings.value = nextSettings
            emit('ready', true)
        } catch (caught) {
            if (requestId !== settingsRequestId) {
                return
            }

            error.value = caught instanceof Error ? caught.message : String(caught)
            emit('ready', false)
        } finally {
            if (requestId !== settingsRequestId) {
                return
            }

            loading.value = false

            if (open.value) {
                await nextTick()
                updateMenuPosition()
            }
        }
    }

    function toggleMenu(): void {
        if (open.value) {
            closeMenu()

            return
        }

        open.value = true
        addPositionListeners()

        void nextTick(updateMenuPosition)
        void refreshSettings()
    }

    function closeMenu(): void {
        open.value = false
        removePositionListeners()
    }

    /** 将菜单固定定位到触发图标旁，避开输入框的 overflow 裁切。 */
    function updateMenuPosition(): void {
        const trigger = triggerRef.value

        if (!trigger || !open.value) {
            return
        }

        const rect = trigger.getBoundingClientRect()
        const menuHeight = menuRef.value?.offsetHeight || 280
        const menuWidth = Math.min(300, window.innerWidth - 32)
        const left = Math.max(16, Math.min(rect.left, window.innerWidth - menuWidth - 16))
        const roomAbove = rect.top
        const roomBelow = window.innerHeight - rect.bottom
        const placeAbove = roomAbove >= menuHeight + 12 || roomBelow < menuHeight + 12
        const top = placeAbove
            ? Math.max(8, rect.top - menuHeight - 10)
            : Math.min(window.innerHeight - menuHeight - 8, rect.bottom + 10)

        menuPosition.value = {
            left: `${left}px`,
            top: `${Math.max(8, top)}px`,
        }
    }

    function addPositionListeners(): void {
        window.addEventListener('resize', updateMenuPosition)
        document.addEventListener('scroll', updateMenuPosition, true)
    }

    function removePositionListeners(): void {
        window.removeEventListener('resize', updateMenuPosition)
        document.removeEventListener('scroll', updateMenuPosition, true)
    }

    async function selectMode(mode: LocalPermissionMode): Promise<void> {
        if (!settings.value || saving.value) {
            return
        }

        if (mode === 'auto' && !approvalModelId.value) {
            return
        }

        saving.value = true
        error.value = ''

        try {
            const nextApprovalModelId = approvalModelId.value
            const conversationId = String(props.conversationId || '').trim()

            if (props.remoteDeviceId) {
                if (conversationId) {
                    await saveRemoteConversationSettings(props.remoteDeviceId, conversationId, {
                        permission_mode: mode,
                        approval_model_id: nextApprovalModelId,
                    })
                } else {
                    await saveRemotePermissionSettings(props.remoteDeviceId, mode, nextApprovalModelId)
                }
            } else if (conversationId) {
                await saveLocalConversationSettings(conversationId, {
                    permission_mode: mode,
                    approval_model_id: nextApprovalModelId,
                })
            } else {
                await saveLocalPermissionSettings(mode, nextApprovalModelId)
            }
            settings.value = {
                ...settings.value,
                mode,
                approval_model_id: nextApprovalModelId,
            }
            emit('changed', mode)
            const selectedOption = permissionOptions[mode]
            showToast(`工具权限已切换为${selectedOption.name}`, 'success', {
                icon: selectedOption.icon,
                color: selectedOption.color,
            })
            closeMenu()
        } catch (caught) {
            error.value = caught instanceof Error ? caught.message : String(caught)
        } finally {
            saving.value = false
        }
    }

    function closeOnOutsideClick(event: MouseEvent): void {
        const target = event.target

        if (!(target instanceof Node)) {
            closeMenu()

            return
        }

        if (!triggerRef.value?.contains(target) && !menuRef.value?.contains(target)) {
            closeMenu()
        }
    }

    /**
     * 桌面端设置保存后由 __ncRefreshToolPermissions 派发的刷新事件。
     * 仅 nexoracode 构建持有事件名,本体构建折叠为空串,避免该标识进入线上产物。
     */
    const DESKTOP_PERMISSION_REFRESH_EVENT =
        import.meta.env.MODE === 'nexoracode' ? 'nexoracode:refresh-tool-permissions' : ''

    /** 桌面端设置保存后由 __ncRefreshToolPermissions 触发,重新拉取权限设置。 */
    function onDesktopPermissionRefresh(): void {
        void refreshSettings()
    }

    onMounted(() => {
        void refreshSettings()
        document.addEventListener('click', closeOnOutsideClick)

        if (DESKTOP_PERMISSION_REFRESH_EVENT) {
            window.addEventListener(DESKTOP_PERMISSION_REFRESH_EVENT, onDesktopPermissionRefresh)
        }
    })

    onBeforeUnmount(() => {
        settingsRequestId += 1
        document.removeEventListener('click', closeOnOutsideClick)

        if (DESKTOP_PERMISSION_REFRESH_EVENT) {
            window.removeEventListener(DESKTOP_PERMISSION_REFRESH_EVENT, onDesktopPermissionRefresh)
        }

        removePositionListeners()
    })

    watch(() => props.selectedModelId, () => {
        if (open.value) {
            void refreshSettings()
        }
    })

    watch(() => props.remoteDeviceId, (deviceId, previousDeviceId) => {
        if (deviceId === previousDeviceId) {
            return
        }

        settings.value = null
        error.value = ''

        if (deviceId) {
            void refreshSettings()
        }
    })

    // 切换会话时重新读取该会话自己的权限：每个会话独立，不能沿用上一个会话的值。
    watch(() => props.conversationId, (conversationId, previousId) => {
        if (conversationId === previousId) {
            return
        }

        settings.value = null
        error.value = ''

        if (conversationId || props.remoteDeviceId) {
            void refreshSettings()
        }
    })
</script>
