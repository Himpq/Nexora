<!--
    SettingModelSelect.vue — 设置通用模型选择下拉(General Design Development Package)

    设计:
      - 自建下拉(禁用原生 select),选项按 provider 分组
      - 每项展示 模型名 + provider 徽标 + 状态徽标
      - 支持首位占位项(如"使用当前对话模型"/"不指定")
      - 内部拉取 /api/admin/models/config(带空态/加载态)

    用法:
      <SettingModelSelect v-model="model" placeholder="使用当前对话模型" width="220px" />
-->

<template>
    <div ref="wrapRef" class="setting-model-select" :style="width ? { width } : undefined">
        <button
            ref="triggerRef"
            type="button"
            class="setting-select-trigger"
            :class="{ open }"
            :aria-expanded="open"
            @click.stop="toggle"
        >
            <span class="setting-select-label">{{ selectedLabel }}</span>
            <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
        </button>

        <div ref="menuRef" class="setting-model-menu" :class="{ open }" :style="menuStyle" role="listbox">
            <!-- 源版 model-options-scroll 结构:外层 fixed+overflow hidden,内层滚动 -->
            <div class="model-options-scroll">
                <div v-if="loading" class="setting-model-menu-state">正在读取可用模型...</div>
                <template v-else>
                    <div v-if="placeholder" class="setting-model-group">
                        <div class="setting-model-group-label">自动</div>
                        <button
                            type="button"
                            role="option"
                            :class="{ active: String(modelValue) === '' }"
                            @click="select('')"
                        >{{ placeholder }}</button>
                    </div>

                    <div v-for="group in groupedOptions" :key="group.label" class="setting-model-group">
                        <div class="setting-model-group-label">{{ group.label }}</div>
                        <button
                            v-for="model in group.items"
                            :key="model.value"
                            type="button"
                            role="option"
                            :class="{ active: String(modelValue) === String(model.value) }"
                            @click="select(model.value)"
                        >
                            <span class="setting-model-name">{{ model.label }}</span>
                            <span class="setting-model-provider">{{ model.provider }}</span>
                            <span class="setting-model-status" :class="statusClass(model.status)">{{ model.status }}</span>
                        </button>
                    </div>

                    <div v-if="!hasOptions" class="setting-model-menu-state">暂无可用模型</div>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

    import { fetchModelsConfig } from '@/api/admin-models'

    export interface SettingModelOption {
        value: string
        label: string
        provider: string
        status: string
    }

    const props = defineProps<{
        modelValue: string | number
        width?: string
        placeholder?: string
    }>()

    const emit = defineEmits<{
        'update:modelValue': [value: string | number]
    }>()

    const open = ref(false)
    const wrapRef = ref<HTMLElement | null>(null)
    const triggerRef = ref<HTMLElement | null>(null)
    const menuRef = ref<HTMLElement | null>(null)
    const menuStyle = ref<Record<string, string>>({})
    const loading = ref(true)
    const models = ref<SettingModelOption[]>([])

    const hasOptions = computed(() => models.value.length > 0)

    /** 按 provider 分组(对齐原版 appendAdminSystemModelSelectGroups) */
    const groupedOptions = computed(() => {
        const groups: Array<{ label: string; items: SettingModelOption[] }> = []

        for (const model of models.value) {
            const label = String(model.provider || '其他')
            let group = groups.find((item) => item.label === label)

            if (!group) {
                group = { label, items: [] }
                groups.push(group)
            }

            group.items.push(model)
        }

        return groups
    })

    const selectedLabel = computed(() => {
        const matched = models.value.find((model) => String(model.value) === String(props.modelValue))

        if (matched) {
            return matched.label
        }

        if (props.modelValue === '' || props.modelValue === null || props.modelValue === undefined) {
            return props.placeholder || '请选择'
        }

        return String(props.modelValue)
    })

    onMounted(() => {
        void loadModels()
        document.addEventListener('click', onPageClick)
        document.addEventListener('keydown', onKeydown)
        document.addEventListener('scroll', onScroll, true)
    })

    onBeforeUnmount(() => {
        document.removeEventListener('click', onPageClick)
        document.removeEventListener('keydown', onKeydown)
        document.removeEventListener('scroll', onScroll, true)
    })

    async function loadModels(): Promise<void> {
        try {
            const config = await fetchModelsConfig()

            models.value = Object.entries(config.models).map(([id, info]) => ({
                value: id,
                label: String(info.name || id),
                provider: String(info.provider || 'unknown'),
                status: String(info.status || 'normal'),
            }))
        } catch {
            models.value = []
        } finally {
            loading.value = false
        }
    }

    function onPageClick(event: MouseEvent): void {
        if (wrapRef.value && !wrapRef.value.contains(event.target as Node)) {
            open.value = false
        }
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            open.value = false
        }
    }

    /** 外部滚动时关闭浮层;浮层自身滚动(仍在 wrap DOM 子树内)不关闭 */
    function onScroll(event: Event): void {
        if (!open.value) {
            return
        }

        if (wrapRef.value && event.target instanceof Node && wrapRef.value.contains(event.target)) {
            return
        }

        open.value = false
    }

    /**
     * 依据触发器位置定位菜单(fixed,不占用父元素体积,防滚动容器裁剪)
     *
     * 对齐原版记忆模型菜单:
     *   - 宽度 min(340px, 视口-24px),高度受 CSS max-height 300px 钳制
     *   - 下方空间不足且上方更充裕 → 向上展开
     *   - left = max(12, min(anchor.left, vw - width - 12))
     */
    function positionMenu(): void {
        const trigger = triggerRef.value

        if (!trigger) {
            return
        }

        const rect = trigger.getBoundingClientRect()
        const vw = window.innerWidth || document.documentElement.clientWidth
        const vh = window.innerHeight || document.documentElement.clientHeight
        const gap = 4

        const menuWidth = Math.min(340, vw - 24)
        const contentHeight = menuRef.value ? menuRef.value.scrollHeight : 300
        const menuHeight = Math.min(contentHeight, 300, vh - 24)

        const spaceBelow = vh - rect.bottom - gap
        const spaceAbove = rect.top - gap
        const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow

        const top = openUp ? rect.top - gap - menuHeight : rect.bottom + gap
        const left = Math.max(12, Math.min(rect.left, vw - menuWidth - 12))

        menuStyle.value = {
            position: 'fixed',
            top: `${Math.round(Math.max(12, top))}px`,
            left: `${Math.round(left)}px`,
            right: 'auto',
            width: `${Math.round(menuWidth)}px`,
        }
    }

    function toggle(): void {
        open.value = !open.value

        if (open.value) {
            // nextTick 后菜单已渲染(display 恢复),才能测量实际内容高度
            void nextTick(positionMenu)
        }
    }

    function select(value: string): void {
        emit('update:modelValue', value)
        open.value = false
    }

    function statusClass(status: string): string {
        const s = String(status || '').toLowerCase()

        return `status-${s === 'error' || s === 'disabled' ? s : 'normal'}`
    }
</script>