<!--
    ModelSelect.vue — 模型选择器(逐像素复刻原版 custom-select 结构)

    结构(与原版 chat_model_select.js 一致):
      custom-select-container > select-selected + select-items
      select-items > model-group(provider 分组) > model-chip-wrap > model-chip

    浮层:
      - 使用 position:fixed 脱离父容器裁剪(对齐原版 chat_memory_settings.css #memoryModelOptions)
      - 自动方向检测:下方空间不足时向上展开
      - 坐标通过 getBoundingClientRect 动态计算
-->

<template>
    <div ref="containerRef" class="custom-select-container" :id="containerId">
        <button
            ref="triggerRef"
            type="button"
            class="select-selected"
            :class="{ 'select-arrow-active': open }"
            :aria-expanded="open ? 'true' : 'false'"
            :aria-haspopup="true"
            @click="toggleOpen"
        >
            <span class="select-selected-text">{{ selectedLabel }}</span>
            <span class="select-chevron" aria-hidden="true"></span>
        </button>

        <Teleport to="body">
            <div
                v-if="open"
                ref="menuRef"
                class="select-items select-items-floating"
                :class="dropdownDirectionClass"
                :style="dropdownStyle"
                role="listbox"
            >
                <div class="model-options-scroll">
                    <!-- 前置分组 (对齐原版 leadingGroup:如"自动"+"使用当前对话模型") -->
                    <section v-if="leadingLabel" class="model-group" :class="leadingGroupClass">
                        <div class="model-group-title">
                            <span class="label">{{ leadingLabel }}</span>
                        </div>
                        <div class="model-chip-wrap">
                            <button
                                type="button"
                                class="model-chip"
                                :class="{ 'same-as-selected': selectedId === '' }"
                                role="option"
                                :aria-selected="selectedId === '' ? 'true' : 'false'"
                                @click="handleSelect('')"
                            >
                                <span class="model-chip-name">{{ leadingPlaceholder }}</span>
                            </button>
                        </div>
                    </section>

                    <section v-for="group in groups" :key="group.provider" class="model-group">
                        <div class="model-group-title">
                            <span class="provider-title-main">
                                <img
                                    v-if="group.icon"
                                    class="provider-logo provider-logo-sm"
                                    :src="group.icon"
                                    alt=""
                                />
                                <span v-else class="provider-logo provider-logo-sm provider-logo-fallback">
                                    {{ group.fallback }}
                                </span>
                                <span class="label">{{ group.provider }}</span>
                            </span>
                        </div>
                        <div class="model-chip-wrap">
                            <button
                                v-for="model in group.models"
                                :key="model.id"
                                type="button"
                                class="model-chip"
                                :class="{ 'same-as-selected': model.id === selectedId }"
                                :data-model-id="model.id"
                                role="option"
                                :aria-selected="model.id === selectedId ? 'true' : 'false'"
                                @click="handleSelect(model.id)"
                            >
                                <span class="model-chip-name" :title="model.name">{{ model.name }}</span>
                                <span
                                    v-if="model.status"
                                    class="model-chip-status"
                                    :class="`model-status-${normalizeStatus(model.status)}`"
                                >
                                    {{ statusLabel(model.status) }}
                                </span>
                            </button>
                        </div>
                    </section>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

    import type { ModelItem } from '@/api/config'
    import { providerIconFallbackText, resolveProviderIconSlug, resolveProviderIconUrl } from '@/api/providerIcons'
    import { useModelStore } from '@/stores/model'
    import { closePopover, openPopover, overlay } from '@/ui/overlay'

    const props = withDefaults(defineProps<{
        models: ModelItem[]
        /** 受控值 (未传则回退到 modelStore.selectedId) */
        modelValue?: string
        /** 浮层 key(默认 'model-select';多实例共存时需区分) */
        popoverKey?: string
        /** 前置分组标签 (如"自动") */
        leadingLabel?: string
        /** 前置分组占位文本 (如"使用当前对话模型") */
        leadingPlaceholder?: string
        /** 前置分组 CSS 类 */
        leadingGroupClass?: string
        /** 容器 ID(默认 'modelSelectContainer') */
        containerId?: string
    }>(), {
        popoverKey: 'model-select',
        containerId: 'modelSelectContainer',
    })

    const emit = defineEmits<{
        'update:modelValue': [value: string]
    }>()

    const modelStore = useModelStore()

    /** 受控优先，否则回退到全局 store */
    const selectedId = computed(() => props.modelValue !== undefined ? props.modelValue : modelStore.selectedId)

    /** 按 provider 分组(保持原版分组渲染) */
    const groups = computed(() => {
        const map = new Map<string, ModelItem[]>()

        props.models.forEach((model) => {
            const provider = resolveProviderIconSlug(model.provider) || String(model.provider || 'other').toLowerCase()

            if (!map.has(provider)) {
                map.set(provider, [])
            }

            map.get(provider)!.push(model)
        })

        return Array.from(map.entries()).map(([provider, models]) => ({
            provider,
            icon: resolveProviderIconUrl(provider),
            fallback: providerIconFallbackText(provider),
            models,
        }))
    })

    const selectedLabel = computed(() => {
        if (selectedId.value === '') {
            return props.leadingPlaceholder || '请选择'
        }

        const model = props.models.find((item) => item.id === selectedId.value)

        return model ? model.name : 'Select Model'
    })

    const STATUS_LABELS: Record<string, string> = {
        good: '良好',
        normal: '正常',
        fast: '快速',
        slow: '缓慢',
        error: '错误',
    }

    function normalizeStatus(status: string): string {
        return String(status || 'normal').toLowerCase()
    }

    function statusLabel(status: string): string {
        return STATUS_LABELS[normalizeStatus(status)] || String(status || '').toUpperCase()
    }

    const containerRef = ref<HTMLElement | null>(null)
    const triggerRef = ref<HTMLButtonElement | null>(null)
    const menuRef = ref<HTMLElement | null>(null)

    /** 下拉方向: 'down'(默认) 或 'up'(下方空间不足时) */
    const dropdownDirection = ref<'down' | 'up'>('down')

    /** 下拉浮层坐标 */
    const dropdownPosition = ref({ left: 0, top: 0 })

    const dropdownDirectionClass = computed(() => `select-items-${dropdownDirection.value}`)

    const dropdownStyle = computed(() => ({
        left: `${dropdownPosition.value.left}px`,
        top: `${dropdownPosition.value.top}px`,
    }))

    /** 下拉打开状态:由浮层协调器统一管理(自动外部关闭 + 互斥) */
    const open = computed(() => overlay.popover === props.popoverKey)

    /**
     * 计算浮层位置 + 方向(对齐原版 chat_memory_settings.css position:fixed 方案)
     *
     * 逻辑:
     *   1. 取 trigger 的 getBoundingClientRect
     *   2. 默认向下展开(top = trigger.bottom + 8px)
     *   3. 若下方空间 < 200px 且上方空间更充裕 → 向上展开(top = trigger.top - 8px - 菜单实测高度)
     *   4. 水平方向:左对齐 trigger,但限制不超出视口右边界
     */
    function computeDropdownPosition(): void {
        const trigger = triggerRef.value

        if (!trigger) {
            return
        }

        const rect = trigger.getBoundingClientRect()
        const vw = window.innerWidth || document.documentElement.clientWidth
        const vh = window.innerHeight || document.documentElement.clientHeight
        const gap = 8
        const minDropdownHeight = 200

        const spaceBelow = vh - rect.bottom - gap
        const spaceAbove = rect.top - gap

        // 方向检测:下方空间不足且上方更充裕时向上展开
        dropdownDirection.value = (spaceBelow < minDropdownHeight && spaceAbove > spaceBelow) ? 'up' : 'down'

        // 水平:左对齐 trigger,但限制不超出右边界(预留 12px 边距)
        let left = rect.left
        const dropdownWidth = Math.min(600, vw - 24)

        if (left + dropdownWidth > vw - 12) {
            left = vw - dropdownWidth - 12
        }

        if (left < 12) {
            left = 12
        }

        // 垂直坐标:向上展开需菜单实测高度(受原版 540px 与视口钳制)
        let top: number

        if (dropdownDirection.value === 'down') {
            top = rect.bottom + gap
        } else {
            const contentHeight = menuRef.value ? menuRef.value.scrollHeight : minDropdownHeight
            const menuHeight = Math.min(contentHeight, 540, vh - 24)

            top = rect.top - gap - menuHeight
        }

        if (top < 12) {
            top = 12
        }

        dropdownPosition.value = { left: Math.round(left), top: Math.round(top) }
    }

    function toggleOpen(): void {
        if (open.value) {
            closePopover(props.popoverKey)

            return
        }

        openPopover(props.popoverKey, containerRef.value)

        // 等 DOM 更新后计算位置
        void nextTick(() => {
            computeDropdownPosition()
        })
    }

    function handleSelect(modelId: string): void {
        // 受控模式:emit 更新;非受控模式:更新 store
        if (props.modelValue !== undefined) {
            emit('update:modelValue', modelId)
        } else {
            modelStore.selectModel(modelId)
        }

        closePopover(props.popoverKey)
    }

    /** 窗口尺寸变化时重算位置 */
    function onWindowResize(): void {
        if (open.value) {
            computeDropdownPosition()
        }
    }

    /** 滚动时重算位置(防止 trigger 位移后浮层错位) */
    function onWindowScroll(): void {
        if (open.value) {
            computeDropdownPosition()
        }
    }

    watch(open, (isOpen) => {
        if (isOpen) {
            window.addEventListener('resize', onWindowResize)
            window.addEventListener('scroll', onWindowScroll, true)
        } else {
            window.removeEventListener('resize', onWindowResize)
            window.removeEventListener('scroll', onWindowScroll, true)
        }
    })

    onBeforeUnmount(() => {
        window.removeEventListener('resize', onWindowResize)
        window.removeEventListener('scroll', onWindowScroll, true)
    })
</script>
