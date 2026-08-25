<template>
    <div
        ref="containerRef"
        :id="props.containerId"
        class="gddp-model-select"
        :style="props.width ? { width: props.width } : undefined"
    >
        <button
            ref="triggerRef"
            type="button"
            class="gddp-model-select-trigger"
            :class="{ open }"
            :aria-expanded="open ? 'true' : 'false'"
            aria-haspopup="listbox"
            @click="toggleOpen"
        >
            <ProviderIcon
                v-if="selectedModel"
                :icon-url="selectedModel.providerIconUrl"
                :fallback-text="selectedModel.providerIconFallback || selectedModel.provider"
                size="sm"
            />
            <span class="gddp-model-select-label">{{ selectedLabel }}</span>
            <i class="fa-solid fa-chevron-down gddp-model-select-chevron" aria-hidden="true"></i>
        </button>

        <Teleport to="body">
            <div
                v-if="open"
                ref="menuRef"
                class="gddp-model-select-menu"
                :style="menuStyle"
                role="listbox"
            >
                <div class="gddp-model-select-scroll">
                    <div v-if="props.loading" class="gddp-model-select-state">正在读取可用模型...</div>

                    <template v-else>
                        <section v-if="props.leadingPlaceholder" class="gddp-model-select-group">
                            <div class="gddp-model-select-group-label">{{ props.leadingLabel || '自动' }}</div>
                            <button
                                type="button"
                                class="gddp-model-select-option"
                                :class="{ active: selectedId === '' }"
                                role="option"
                                :aria-selected="selectedId === '' ? 'true' : 'false'"
                                @click="select('')"
                            >
                                <span class="gddp-model-select-option-name">{{ props.leadingPlaceholder }}</span>
                            </button>
                        </section>

                        <section
                            v-for="group in groups"
                            :key="group.key"
                            class="gddp-model-select-group"
                        >
                            <div class="gddp-model-select-group-label">
                                <ProviderIcon
                                    :icon-url="group.iconUrl"
                                    :fallback-text="group.iconFallback"
                                    size="sm"
                                />
                                <span>{{ group.provider }}</span>
                            </div>
                            <button
                                v-for="model in group.models"
                                :key="model.id"
                                type="button"
                                class="gddp-model-select-option"
                                :class="{ active: model.id === selectedId }"
                                :data-model-id="model.id"
                                role="option"
                                :aria-selected="model.id === selectedId ? 'true' : 'false'"
                                @click="select(model.id)"
                            >
                                <ProviderIcon
                                    :icon-url="model.providerIconUrl"
                                    :fallback-text="model.providerIconFallback || model.provider"
                                    size="sm"
                                />
                                <span class="gddp-model-select-option-name" :title="model.name">{{ model.name }}</span>
                                <span class="gddp-model-select-provider">{{ model.provider }}</span>
                                <span
                                    v-if="model.status"
                                    class="gddp-model-select-status"
                                    :class="statusClass(model.status)"
                                >{{ statusLabel(model.status) }}</span>
                            </button>
                        </section>

                        <div v-if="groups.length === 0" class="gddp-model-select-state">
                            {{ props.emptyLabel }}
                        </div>
                    </template>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

    import { closePopover, openPopover, overlay } from '@/ui/overlay'

    import ProviderIcon from './ProviderIcon.vue'
    import type { ModelSelectOption } from './types'

    const props = withDefaults(defineProps<{
        models: ModelSelectOption[]
        modelValue?: string
        popoverKey?: string
        leadingLabel?: string
        leadingPlaceholder?: string
        containerId?: string
        width?: string
        loading?: boolean
        emptyLabel?: string
    }>(), {
        popoverKey: undefined,
        containerId: 'gddpModelSelectContainer',
        loading: false,
        emptyLabel: '暂无可用模型',
    })

    const autoPopoverKey = `gddp-model-select-${useId()}`
    const effectivePopoverKey = computed(() => props.popoverKey ?? autoPopoverKey)

    const emit = defineEmits<{
        'update:modelValue': [value: string]
    }>()

    const selectedId = computed(() => props.modelValue ?? '')
    const selectedModel = computed(() => props.models.find((model) => model.id === selectedId.value))
    const selectedLabel = computed(() => selectedModel.value?.name || props.leadingPlaceholder || '请选择')
    const open = computed(() => overlay.popover === effectivePopoverKey.value)

    const groups = computed(() => {
        const groupMap = new Map<string, {
            key: string
            provider: string
            iconUrl: string
            iconFallback: string
            models: ModelSelectOption[]
        }>()

        for (const model of props.models) {
            const provider = model.provider.trim() || '其他'
            const key = provider.toLocaleLowerCase()
            const group = groupMap.get(key)

            if (group) {
                group.models.push(model)
            } else {
                groupMap.set(key, {
                    key,
                    provider,
                    iconUrl: model.providerIconUrl || '',
                    iconFallback: model.providerIconFallback || provider,
                    models: [model],
                })
            }
        }

        return Array.from(groupMap.values())
    })

    const containerRef = ref<HTMLElement | null>(null)
    const triggerRef = ref<HTMLButtonElement | null>(null)
    const menuRef = ref<HTMLElement | null>(null)
    const dropdownPosition = ref({ left: 0, top: 0, width: 0, maxHeight: 420 })

    const menuStyle = computed(() => ({
        left: `${dropdownPosition.value.left}px`,
        top: `${dropdownPosition.value.top}px`,
        width: `${dropdownPosition.value.width}px`,
        maxHeight: `${dropdownPosition.value.maxHeight}px`,
    }))

    const STATUS_LABELS: Record<string, string> = {
        good: '良好',
        normal: '正常',
        fast: '快速',
        slow: '缓慢',
        error: '错误',
        disabled: '禁用',
    }

    function normalizeStatus(status: string): string {
        return String(status || 'normal').toLowerCase()
    }

    function statusLabel(status: string): string {
        return STATUS_LABELS[normalizeStatus(status)] || String(status || '').toUpperCase()
    }

    function statusClass(status: string): string {
        const normalized = normalizeStatus(status)

        return `status-${normalized === 'error' || normalized === 'disabled' ? normalized : 'normal'}`
    }

    function positionMenu(): void {
        const trigger = triggerRef.value

        if (!trigger) {
            return
        }

        const rect = trigger.getBoundingClientRect()
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight
        const isMobile = viewportWidth <= 980
        const width = isMobile
            ? Math.min(Math.max(260, Math.floor(viewportWidth * 0.92)), 380)
            : Math.min(420, viewportWidth - 24)
        const contentHeight = menuRef.value?.scrollHeight || 300
        const gap = 6
        const spaceBelow = viewportHeight - rect.bottom - gap
        const spaceAbove = rect.top - gap
        // 先按视口与内容预估高度,再按实际可用空间收敛,避免在设置弹窗等窄视口内溢出屏幕
        const maxAllowedHeight = isMobile ? Math.floor(viewportHeight * 0.62) : 420
        const desiredHeight = Math.min(contentHeight, maxAllowedHeight, viewportHeight - 24)
        const openUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow
        const availableSpace = openUp ? spaceAbove : spaceBelow
        const height = Math.min(desiredHeight, Math.max(160, availableSpace - 12))
        const rawTop = isMobile
            ? Math.min(rect.bottom + 8, Math.max(70, viewportHeight - height - 12))
            : (openUp ? rect.top - gap - height : rect.bottom + gap)
        const left = Math.max(isMobile ? 6 : 12, Math.min(rect.left, viewportWidth - width - (isMobile ? 6 : 12)))

        dropdownPosition.value = {
            left: Math.round(left),
            top: Math.round(Math.max(12, rawTop)),
            width: Math.round(width),
            maxHeight: Math.round(height),
        }
    }

    /** 打开菜单后将当前模型滚动到可见区域,保持原版选择器的定位反馈。 */
    function scrollSelectedOptionIntoView(): void {
        const selected = menuRef.value?.querySelector<HTMLElement>('[aria-selected="true"]')

        selected?.scrollIntoView({ block: 'nearest' })
    }

    function toggleOpen(): void {
        if (open.value) {
            closePopover(effectivePopoverKey.value)

            return
        }

        openPopover(effectivePopoverKey.value, containerRef.value)
        void nextTick(() => {
            positionMenu()
            scrollSelectedOptionIntoView()
        })
    }

    function select(value: string): void {
        emit('update:modelValue', value)
        closePopover(effectivePopoverKey.value)
    }

    function updateMenuPosition(): void {
        if (open.value) {
            positionMenu()
        }
    }

    watch(open, (isOpen) => {
        if (isOpen) {
            window.addEventListener('resize', updateMenuPosition)
            window.addEventListener('scroll', updateMenuPosition, true)
        } else {
            window.removeEventListener('resize', updateMenuPosition)
            window.removeEventListener('scroll', updateMenuPosition, true)
        }
    })

    onBeforeUnmount(() => {
        window.removeEventListener('resize', updateMenuPosition)
        window.removeEventListener('scroll', updateMenuPosition, true)

        if (open.value) {
            closePopover(effectivePopoverKey.value)
        }
    })
</script>
