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
        fetchLocalPermissionSettings,
        saveLocalPermissionSettings,
        type LocalPermissionMode,
        type LocalPermissionSettings,
    } from '@/api/nexoracodeLocal'
    import { showToast } from '@/stores/notify'

    const props = defineProps<{
        selectedModelId: string
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
        if (loading.value) {
            return
        }

        loading.value = true
        error.value = ''

        try {
            settings.value = await fetchLocalPermissionSettings()
            emit('ready', true)
        } catch (caught) {
            error.value = caught instanceof Error ? caught.message : String(caught)
            emit('ready', false)
        } finally {
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

            await saveLocalPermissionSettings(mode, nextApprovalModelId)
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

    onMounted(() => {
        void refreshSettings()
        document.addEventListener('click', closeOnOutsideClick)
    })

    onBeforeUnmount(() => {
        document.removeEventListener('click', closeOnOutsideClick)
        removePositionListeners()
    })

    watch(() => props.selectedModelId, () => {
        if (open.value) {
            void refreshSettings()
        }
    })
</script>
