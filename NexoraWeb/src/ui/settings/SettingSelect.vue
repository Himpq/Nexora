<!--
    SettingSelect.vue — 设置通用下拉(General Design Development Package)

    设计:
      - 自建下拉(禁用原生 select/Chrome 样式),按钮 + 浮层列表
      - 点击外部 / Esc 关闭;选中后自动关闭
      - 支持禁用的占位选项(placeholder)

    用法:
      <SettingSelect
          v-model="theme"
          :options="[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]"
          width="160px"
      />
-->

<template>
    <div ref="wrapRef" class="setting-select" :style="width ? { width } : undefined">
        <button
            ref="triggerRef"
            type="button"
            class="setting-select-trigger"
            :class="{ open: open }"
            :aria-expanded="open"
            @click.stop="toggle"
        >
            <span class="setting-select-label">{{ selectedLabel }}</span>
            <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
        </button>

        <div class="setting-select-menu" :class="{ open }" :style="menuStyle" role="listbox">
            <div v-if="search" class="setting-select-search">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <input
                    v-model="searchText"
                    type="text"
                    :placeholder="searchPlaceholder || '搜索...'"
                    autocomplete="off"
                >
            </div>
            <template v-if="hasGroups">
                <template v-for="group in filteredGroups" :key="group.name">
                    <div class="setting-select-group-title">{{ group.name }}</div>
                    <button
                        v-for="option in group.options"
                        :key="String(option.value)"
                        type="button"
                        role="option"
                        :class="{ active: String(option.value) === String(modelValue) }"
                        @click="select(option.value)"
                    >{{ option.label }}</button>
                </template>
            </template>
            <button
                v-for="option in filteredOptions"
                v-else
                :key="String(option.value)"
                type="button"
                role="option"
                :class="{ active: String(option.value) === String(modelValue) }"
                @click="select(option.value)"
            >{{ option.label }}</button>
            <div v-if="searchEmpty" class="setting-select-menu-state">无匹配项</div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

    import { closePopover, openPopover, overlay } from '@/ui/overlay'

    export interface SettingSelectOption {
        value: string | number
        label: string
        /** 分组名:设置后该选项按组渲染(对齐原版 admin-system-model-group) */
        group?: string
    }

    const props = withDefaults(defineProps<{
        modelValue: string | number
        options: SettingSelectOption[]
        width?: string
        placeholder?: string
        /** 菜单内搜索过滤(长列表场景,如认证 owner 用户选择) */
        search?: boolean
        searchPlaceholder?: string
        popoverKey?: string
    }>(), {
        popoverKey: 'setting-select',
    })

    const emit = defineEmits<{
        'update:modelValue': [value: string | number]
    }>()

    const wrapRef = ref<HTMLElement | null>(null)
    const triggerRef = ref<HTMLElement | null>(null)

    /** 菜单内搜索词(打开时重置) */
    const searchText = ref('')

    /** 菜单定位(fixed,避免被滚动容器裁剪) */
    const menuStyle = ref<Record<string, string>>({})

    /** 是否有分组(任意选项带 group 即启用分组渲染) */
    const hasGroups = computed(() => {
        return props.options.some((option) => Boolean(option.group))
    })

    /** 按 group 分组的选项(保持原顺序,组内顺序不变) */
    const groupedOptions = computed(() => {
        const groups: Array<{ name: string; options: SettingSelectOption[] }> = []

        for (const option of props.options) {
            const name = option.group || '默认'
            const last = groups[groups.length - 1]

            if (last && last.name === name) {
                last.options.push(option)
            } else {
                groups.push({ name, options: [option] })
            }
        }

        return groups
    })

    /** 搜索过滤后的平铺选项 */
    const filteredOptions = computed(() => {
        const keyword = searchText.value.trim().toLowerCase()

        if (!props.search || !keyword) {
            return props.options
        }

        return props.options.filter((option) => String(option.label).toLowerCase().includes(keyword))
    })

    /** 搜索过滤后的分组选项(空组剔除) */
    const filteredGroups = computed(() => {
        const keyword = searchText.value.trim().toLowerCase()

        if (!props.search || !keyword) {
            return groupedOptions.value
        }

        return groupedOptions.value
            .map((group) => ({
                name: group.name,
                options: group.options.filter((option) => String(option.label).toLowerCase().includes(keyword)),
            }))
            .filter((group) => group.options.length > 0)
    })

    /** 搜索无匹配(用于空态提示) */
    const searchEmpty = computed(() => {
        if (!props.search || !searchText.value.trim()) {
            return false
        }

        return hasGroups.value ? filteredGroups.value.length === 0 : filteredOptions.value.length === 0
    })

    const selectedLabel = computed(() => {
        const matched = props.options.find((option) => String(option.value) === String(props.modelValue))

        return matched ? matched.label : (props.placeholder || '请选择')
    })

    const open = computed(() => overlay.popover === props.popoverKey)

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
            closePopover(props.popoverKey)
        }
    })

    function toggle(): void {
        if (open.value) {
            closePopover(props.popoverKey)

            return
        }

        searchText.value = ''
        openPopover(props.popoverKey, wrapRef.value)
        void nextTick(positionMenu)
    }

    /** 依据触发器位置定位菜单(覆盖 absolute 定位,防滚动容器裁剪) */
    function positionMenu(): void {
        const trigger = triggerRef.value

        if (!trigger) {
            return
        }

        const rect = trigger.getBoundingClientRect()
        const vw = window.innerWidth || document.documentElement.clientWidth
        const vh = window.innerHeight || document.documentElement.clientHeight
        const width = Math.min(Math.max(rect.width, 160), vw - 24)
        const contentHeight = 300
        const spaceBelow = vh - rect.bottom - 4
        const spaceAbove = rect.top - 4
        const openUp = spaceBelow < contentHeight && spaceAbove > spaceBelow
        const rawTop = openUp ? rect.top - 4 - contentHeight : rect.bottom + 4
        const left = Math.max(12, Math.min(rect.left, vw - width - 12))

        menuStyle.value = {
            position: 'fixed',
            top: `${Math.round(Math.max(12, rawTop))}px`,
            left: `${Math.round(left)}px`,
            right: 'auto',
            minWidth: `${Math.round(width)}px`,
        }
    }

    function select(value: string | number): void {
        emit('update:modelValue', value)
        closePopover(props.popoverKey)
    }
</script>
